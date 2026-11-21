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
  'function rewriteAntigravityLoopbackHost(upstream, req) {',
  '  const url = req.originalUrl || req.url || "";',
  '  const matched = /(?:^|\\/)proxy\\/(\\d+)(?:[/?]|$)/.exec(url);',
  '  if (!matched) return;',
  '  const port = matched[1];',
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
].join('\n');
source = source.replace(hook, match[0] + '\n' + injected + '\n');
fs.writeFileSync(path, source);
console.log(`Patched Antigravity loopback proxy in ${path}`);
