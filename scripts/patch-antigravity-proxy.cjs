'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// The standalone code-server tarball can use a nested node_modules layout.
const paths = execFileSync('find', [
  '/opt/code-server', '-type', 'f', '-path', '*/out/node/proxy.js',
], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
if (paths.length !== 1) {
  throw new Error(`Expected one code-server proxy.js, found ${paths.length}: ${paths.join(', ')}`);
}
const path = paths[0];
let source = fs.readFileSync(path, 'utf8');
const marker = '/* Antigravity loopback-only Hub Host/Origin compatibility */';
if (source.includes(marker)) {
  console.log(`Already patched ${path}`);
  process.exit(0);
}

// Hook outbound HTTP and WebSocket proxy requests after code-server authentication.
// Match upstream's actual compiled proxy code, and fail loudly on upstream changes.
const hook = /((?:exports\.)?proxy)\.on\(\s*(['"])proxyReq\2\s*,\s*stripCookie\s*\)\s*;?/;
const match = source.match(hook);
if (!match) {
  throw new Error(`Could not locate code-server proxyReq hook in ${path}`);
}
const instance = match[1];
const injected = [
  marker,
  'const agyHubPorts = new Set();',
  'function antigravityProxyPort(req) {',
  '  const url = req.originalUrl || req.url || "";',
  '  const matched = /(?:^|\\/)proxy\\/(\\d+)(?:[/?]|$)/.exec(url);',
  '  return matched ? matched[1] : null;',
  '}',
  'function rewriteAntigravityLoopbackHost(upstream, req) {',
  '  const url = req.originalUrl || req.url || "";',
  '  const port = antigravityProxyPort(req);',
  '  if (!port) return;',
  '  // Learn the dynamic Hub port from the extension iframe request.',
  '  if (url.includes("extensionView=true") &&',
  '      url.includes("extensionVariant=vs-code") &&',
  '      url.includes("appName=code-server")) {',
  '    agyHubPorts.add(port);',
  '  }',
  '  if (!agyHubPorts.has(port)) return;',
  '  upstream.setHeader("Host", "localhost:" + port);',
  '  // Only normalize Origin on the already-authenticated upstream hop.',
  '  if (req.headers.origin) {',
  '    upstream.setHeader("Origin", "http://localhost:" + port);',
  '  }',
  '}',
  `${instance}.on("proxyReq", rewriteAntigravityLoopbackHost);`,
  `${instance}.on("proxyReqWs", rewriteAntigravityLoopbackHost);`,
  // http-proxy emits proxyRes before copying headers and calling proxyRes.pipe(res).
  // Replace only the HTML stream for a recognized Hub port. Keep gzip encoding
  // when present, and remove stale length/validators after rewriting the bytes.
  'function rewriteAntigravityHtml(proxyRes, req) {',
  '  const port = antigravityProxyPort(req);',
  '  if (!port || !agyHubPorts.has(port)) return;',
  '  if (!/^text\\/html(?:\\s*;|$)/i.test(proxyRes.headers["content-type"] || "")) return;',
  '  const encoding = (proxyRes.headers["content-encoding"] || "identity").toLowerCase();',
  '  if (encoding !== "identity" && encoding !== "gzip") return;',
  '  const zlib = require("node:zlib");',
  '  const { Transform } = require("node:stream");',
  '  delete proxyRes.headers["content-length"];',
  '  delete proxyRes.headers.etag;',
  '  delete proxyRes.headers["content-md5"];',
  '  const pipe = proxyRes.pipe.bind(proxyRes);',
  '  proxyRes.pipe = function (destination, options) {',
  '    const chunks = [];',
  '    const rewrite = new Transform({',
  '      transform(chunk, _encoding, done) { chunks.push(chunk); done(); },',
  '      flush(done) {',
  '        try {',
  '          const bytes = Buffer.concat(chunks);',
  '          const html = (encoding === "gzip" ? zlib.gunzipSync(bytes) : bytes).toString("utf8");',
  '          const updated = html.replace(/\\b(src|href|action)=([\\x22\\x27])\\/(?!\\/)/gi,',
  '            (_whole, attribute, quote) => attribute + "=" + quote + "/proxy/" + port + "/");',
  '          const output = Buffer.from(updated, "utf8");',
  '          this.push(encoding === "gzip" ? zlib.gzipSync(output) : output);',
  '          done();',
  '        } catch (error) { done(error); }',
  '      },',
  '    });',
  '    rewrite.on("error", () => destination.destroy());',
  '    pipe(rewrite);',
  '    return rewrite.pipe(destination, options);',
  '  };',
  '}',
  `${instance}.on("proxyRes", rewriteAntigravityHtml);`,
].join('\n');
source = source.replace(hook, match[0] + '\n' + injected + '\n');
fs.writeFileSync(path, source);
console.log(`Patched Antigravity loopback proxy in ${path}`);
