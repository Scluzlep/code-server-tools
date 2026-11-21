'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function resolveProxyPath() {
  if (process.argv[2]) {
    return process.argv[2];
  }
  // The standalone code-server tarball can use a nested node_modules layout.
  const paths = execFileSync('find', [
    '/opt/code-server', '-type', 'f', '-path', '*/out/node/proxy.js',
  ], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (paths.length !== 1) {
    throw new Error(`Expected one code-server proxy.js, found ${paths.length}: ${paths.join(', ')}`);
  }
  return paths[0];
}

// Serialized into code-server's proxy.js and injected into proxied Hub HTML.
// Must remain strictly self-contained and free of closing script tags.
function antigravityProxyInfo(req) {
  const url = req.originalUrl || req.url || '';
  const matched = /^([^?#]*?\/proxy\/(\d+))(?:[/?#]|$)/.exec(url);
  return matched ? { prefix: matched[1], port: matched[2] } : null;
}

function rewriteAntigravityLoopbackHost(upstream, req) {
  const url = req.originalUrl || req.url || '';
  const info = antigravityProxyInfo(req);
  if (!info) return;
  const port = info.port;
  // Learn the dynamic Hub port from the extension iframe request.
  if (url.includes('extensionView=true') &&
      url.includes('extensionVariant=vs-code') &&
      url.includes('appName=code-server')) {
    agyHubPorts.add(port);
  }
  if (!agyHubPorts.has(port)) return;
  // code-server's pathProxy builds target URLs with a leading double slash.
  if (typeof upstream.path === 'string' && upstream.path.startsWith('//')) {
    upstream.path = upstream.path.replace(/^\/+/, '/');
  }
  upstream.setHeader('Host', 'localhost:' + port);
  // Only normalize Origin on the already-authenticated upstream hop.
  if (req.headers.origin) {
    upstream.setHeader('Origin', 'http://localhost:' + port);
  }
  if (String(req.headers.accept || '').includes('text/html') && req.headers['accept-encoding']) {
    upstream.setHeader('Accept-Encoding', 'gzip, br, identity');
  }
}

function antigravityClientBridge(base) {
  if (window.__agyProxyBridgeInstalled) return;
  window.__agyProxyBridgeInstalled = true;
  base = String(base || '').replace(/\/+$/, '');
  if (!base) return;

  function hasBase(pathname) {
    return pathname === base || pathname.startsWith(base + '/');
  }

  function rewriteUrl(raw, allowWs) {
    if (raw == null) return raw;
    var isUrlObj = typeof URL !== 'undefined' && raw instanceof URL;
    var str = isUrlObj ? raw.href : String(raw);
    if (!str || str[0] === '#') return raw;
    if (/^(?:data|blob|about|javascript|mailto|vscode|vscode-webview|vscode-file|file):/i.test(str)) {
      return raw;
    }
    if (str[0] === '/' && str[1] !== '/') {
      var pathOnly = str.split(/[?#]/, 1)[0];
      if (hasBase(pathOnly)) return raw;
      var prefixed = base + str;
      return isUrlObj ? new URL(prefixed, window.location.origin) : prefixed;
    }
    try {
      var loc = window.location;
      var parsed = new URL(str, loc.origin + '/');
      var isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      var isWs = parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
      if (((isHttp && parsed.origin === loc.origin) || (allowWs && isWs && parsed.host === loc.host)) &&
          !hasBase(parsed.pathname)) {
        parsed.pathname = base + (parsed.pathname[0] === '/' ? parsed.pathname : '/' + parsed.pathname);
        return isUrlObj ? parsed : parsed.href;
      }
    } catch (_err) {}
    return raw;
  }

  try {
    var curPath = window.location.pathname || '/';
    if (hasBase(curPath) && window.history && typeof window.history.replaceState === 'function') {
      var stripped = curPath.slice(base.length) || '/';
      if (stripped[0] !== '/') stripped = '/' + stripped;
      window.history.replaceState(
        window.history.state,
        '',
        stripped + window.location.search + window.location.hash
      );
    }
  } catch (_err) {}

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        var nextReqUrl = rewriteUrl(input.url, false);
        if (nextReqUrl !== input.url) {
          input = new Request(nextReqUrl, input);
        }
      } else {
        input = rewriteUrl(input, false);
      }
      return origFetch.apply(this, arguments.length > 1 ? [input, init] : [input]);
    };
  }

  var OrigWebSocket = window.WebSocket;
  if (typeof OrigWebSocket === 'function') {
    window.WebSocket = class WebSocket extends OrigWebSocket {
      constructor(url, protocols) {
        var nextUrl = rewriteUrl(url, true);
        if (arguments.length > 1 && protocols !== void 0) {
          super(nextUrl, protocols);
        } else {
          super(nextUrl);
        }
      }
    };
  }

  var OrigEventSource = window.EventSource;
  if (typeof OrigEventSource === 'function') {
    window.EventSource = class EventSource extends OrigEventSource {
      constructor(url, eventSourceInitDict) {
        var nextUrl = rewriteUrl(url, false);
        if (arguments.length > 1 && eventSourceInitDict !== void 0) {
          super(nextUrl, eventSourceInitDict);
        } else {
          super(nextUrl);
        }
      }
    };
  }

  if (typeof XMLHttpRequest !== 'undefined' &&
      XMLHttpRequest.prototype &&
      typeof XMLHttpRequest.prototype.open === 'function') {
    var origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (_method, url) {
      var args = Array.prototype.slice.call(arguments);
      if (args.length >= 2) {
        args[1] = rewriteUrl(url, false);
      }
      return origXhrOpen.apply(this, args);
    };
  }

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    var origSendBeacon = navigator.sendBeacon;
    try {
      navigator.sendBeacon = function (url, data) {
        var nextUrl = rewriteUrl(url, false);
        return arguments.length > 1
          ? origSendBeacon.call(this, nextUrl, data)
          : origSendBeacon.call(this, nextUrl);
      };
    } catch (_err) {}
  }

  var OrigWorker = window.Worker;
  if (typeof OrigWorker === 'function') {
    window.Worker = class Worker extends OrigWorker {
      constructor(scriptURL, options) {
        var nextUrl = rewriteUrl(scriptURL, false);
        if (arguments.length > 1 && options !== void 0) {
          super(nextUrl, options);
        } else {
          super(nextUrl);
        }
      }
    };
  }

  var OrigSharedWorker = window.SharedWorker;
  if (typeof OrigSharedWorker === 'function') {
    window.SharedWorker = class SharedWorker extends OrigSharedWorker {
      constructor(scriptURL, options) {
        var nextUrl = rewriteUrl(scriptURL, false);
        if (arguments.length > 1 && options !== void 0) {
          super(nextUrl, options);
        } else {
          super(nextUrl);
        }
      }
    };
  }

  if (typeof AudioWorklet !== 'undefined' &&
      AudioWorklet.prototype &&
      typeof AudioWorklet.prototype.addModule === 'function') {
    var origAddModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (moduleURL, options) {
      var nextUrl = rewriteUrl(moduleURL, false);
      return arguments.length > 1
        ? origAddModule.call(this, nextUrl, options)
        : origAddModule.call(this, nextUrl);
    };
  }

  var OrigAudio = window.Audio;
  if (typeof OrigAudio === 'function') {
    window.Audio = function Audio(src) {
      return arguments.length > 0 && src !== void 0
        ? new OrigAudio(rewriteUrl(src, false))
        : new OrigAudio();
    };
    window.Audio.prototype = OrigAudio.prototype;
  }

  function patchAttrProp(ctorName, prop) {
    var Ctor = window[ctorName];
    if (!Ctor || !Ctor.prototype) return;
    var desc = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
    if (!desc || !desc.set || !desc.configurable) return;
    Object.defineProperty(Ctor.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (val) {
        return desc.set.call(this, rewriteUrl(val, false));
      },
    });
  }

  patchAttrProp('HTMLImageElement', 'src');
  patchAttrProp('HTMLScriptElement', 'src');
  patchAttrProp('HTMLMediaElement', 'src');
  patchAttrProp('HTMLAudioElement', 'src');
  patchAttrProp('HTMLVideoElement', 'src');
  patchAttrProp('HTMLSourceElement', 'src');
  patchAttrProp('HTMLIFrameElement', 'src');
  patchAttrProp('HTMLEmbedElement', 'src');
  patchAttrProp('HTMLLinkElement', 'href');

  if (typeof Element !== 'undefined' &&
      Element.prototype &&
      typeof Element.prototype.setAttribute === 'function') {
    var origSetAttribute = Element.prototype.setAttribute;
    var srcTags = /^(?:IMG|SCRIPT|AUDIO|VIDEO|SOURCE|IFRAME|EMBED)$/i;
    Element.prototype.setAttribute = function (name, value) {
      if (typeof name === 'string') {
        var lower = name.toLowerCase();
        var tag = this && this.tagName ? String(this.tagName) : '';
        if ((lower === 'src' && srcTags.test(tag)) || (lower === 'href' && /^LINK$/i.test(tag))) {
          value = rewriteUrl(value, false);
        }
      }
      return origSetAttribute.call(this, name, value);
    };
  }
}

// http-proxy emits proxyRes before copying headers and calling proxyRes.pipe(res).
// Replace only the HTML stream for a recognized Hub port. Keep gzip/br encoding
// when present, and remove stale length/validators after rewriting the bytes.
function rewriteAntigravityHtml(proxyRes, req) {
  const info = antigravityProxyInfo(req);
  if (!info || !agyHubPorts.has(info.port)) return;
  if (req.method === 'HEAD' || proxyRes.statusCode !== 200) return;
  if (!/^text\/html(?:\s*;|$)/i.test(proxyRes.headers['content-type'] || '')) return;
  const encoding = (proxyRes.headers['content-encoding'] || 'identity').toLowerCase().trim();
  if (encoding !== 'identity' && encoding !== 'gzip' && encoding !== 'br') return;
  const zlib = require('node:zlib');
  const { Transform } = require('node:stream');
  const prefix = info.prefix;
  delete proxyRes.headers['content-length'];
  delete proxyRes.headers.etag;
  delete proxyRes.headers['content-md5'];
  const pipe = proxyRes.pipe.bind(proxyRes);
  proxyRes.pipe = function (destination, options) {
    const chunks = [];
    const rewrite = new Transform({
      transform(chunk, _encoding, done) { chunks.push(chunk); done(); },
      flush(done) {
        try {
          const bytes = Buffer.concat(chunks);
          let raw = bytes;
          if (encoding === 'gzip') raw = zlib.gunzipSync(bytes);
          else if (encoding === 'br') raw = zlib.brotliDecompressSync(bytes);
          const html = raw.toString('utf8');
          const attrRe = /\b(src|href|action)=([\x22\x27])(\/(?!\/)[^\x22\x27]*)\2/gi;
          const updated = html.replace(attrRe, (whole, attribute, quote, value) => {
            if (value === prefix || value.startsWith(prefix + '/')) return whole;
            return attribute + '=' + quote + prefix + value + quote;
          });
          const bridgePayload = JSON.stringify(prefix).replace(/</g, '\\u003c');
          const bridgeScript = '<script>(' + antigravityClientBridge.toString() + ')(' + bridgePayload + ');<' + '/script>';
          let withBridge;
          if (/<head(?:\s[^>]*)?>/i.test(updated)) {
            withBridge = updated.replace(/<head(?:\s[^>]*)?>/i, (head) => head + bridgeScript);
          } else if (/<\/head>/i.test(updated)) {
            withBridge = updated.replace(/<\/head>/i, (closeHead) => bridgeScript + closeHead);
          } else {
            withBridge = bridgeScript + updated;
          }
          const output = Buffer.from(withBridge, 'utf8');
          let compressed = output;
          if (encoding === 'gzip') compressed = zlib.gzipSync(output);
          else if (encoding === 'br') compressed = zlib.brotliCompressSync(output);
          this.push(compressed);
          done();
        } catch (error) { done(error); }
      },
    });
    rewrite.on('error', () => destination.destroy());
    pipe(rewrite);
    return rewrite.pipe(destination, options);
  };
}

const targetPath = resolveProxyPath();
let source = fs.readFileSync(targetPath, 'utf8');
const marker = '/* Antigravity loopback-only Hub Host/Origin compatibility */';
if (source.includes(marker)) {
  console.log(`Already patched ${targetPath}`);
  process.exit(0);
}

// Hook outbound HTTP and WebSocket proxy requests after code-server authentication.
// Match upstream's actual compiled proxy code, and fail loudly on upstream changes.
const hook = /((?:exports\.)?proxy)\.on\(\s*(['"])proxyReq\2\s*,\s*stripCookie\s*\)\s*;?/;
const match = source.match(hook);
if (!match) {
  throw new Error(`Could not locate code-server proxyReq hook in ${targetPath}`);
}
const instance = match[1];
const injected = [
  marker,
  'const agyHubPorts = new Set();',
  antigravityProxyInfo.toString(),
  rewriteAntigravityLoopbackHost.toString(),
  `${instance}.on("proxyReq", rewriteAntigravityLoopbackHost);`,
  `${instance}.on("proxyReqWs", rewriteAntigravityLoopbackHost);`,
  antigravityClientBridge.toString(),
  rewriteAntigravityHtml.toString(),
  `${instance}.on("proxyRes", rewriteAntigravityHtml);`,
].join('\n');
source = source.replace(hook, match[0] + '\n' + injected + '\n');
fs.writeFileSync(targetPath, source);
console.log(`Patched Antigravity loopback proxy in ${targetPath}`);
