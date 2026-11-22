'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function loadProxyHelpers() {
  for (const candidate of [
    path.join(__dirname, 'patch-antigravity-proxy.cjs'),
    '/usr/local/lib/patch-antigravity-proxy.cjs',
  ]) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  throw new Error('Could not find patch-antigravity-proxy.cjs');
}

const { antigravityClientBridge, rewriteAntigravityHtmlStream } = loadProxyHelpers();

const SESSION_NAME_RE = /^[A-Za-z0-9._-]{1,48}$/;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function redactSecrets(text) {
  return String(text || '')
    .replace(/(--?(?:csrf[_-]?token|extension[_-]?server[_-]?csrf[_-]?token|host[_-]?bridge[_-]?token)\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/([?&](?:code|state|token|t|csrf|api_key|key)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bya29\.[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_TOKEN]');
}

function stripCookieHeader(cookieHeader, cookieName) {
  if (!cookieHeader || !cookieName) return cookieHeader;
  const kept = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const eq = part.indexOf('=');
      const name = (eq === -1 ? part : part.slice(0, eq)).trim();
      return name !== cookieName;
    });
  return kept.join('; ');
}

function parseSubProxyPath(rawUrl, segment) {
  const m = new RegExp('^([^?#]*?\\/' + segment + ')(\\/[^?#]*)?(\\?[^#]*)?').exec(rawUrl || '');
  if (!m) return null;
  const prefix = m[1];
  const tailPath = (m[2] || '/').replace(/^\/+/, '/');
  const search = m[3] || '';
  return { prefix, tailPath, search };
}

function normalizeForwardedHeaders(req, opts) {
  const headers = {};
  for (const [rawKey, rawVal] of Object.entries(req.headers || {})) {
    const key = rawKey.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key)) continue;
    if (key === 'x-forwarded-host' || key === 'forwarded') continue;
    if (key === 'cookie') {
      const cleaned = stripCookieHeader(Array.isArray(rawVal) ? rawVal.join('; ') : String(rawVal || ''), opts.cookieSessionName);
      if (cleaned) headers.cookie = cleaned;
      continue;
    }
    headers[key] = rawVal;
  }
  headers.host = opts.targetHostHeader;
  if (req.headers && req.headers.origin && opts.targetOrigin) {
    headers.origin = opts.targetOrigin;
  }
  if (opts.rewriteHtmlPrefix && String(req.headers && req.headers.accept || '').includes('text/html') && headers['accept-encoding']) {
    headers['accept-encoding'] = 'gzip, br, identity';
  }
  return headers;
}

function forwardHttp(req, res, opts) {
  const headers = normalizeForwardedHeaders(req, opts);
  const upstreamReq = http.request({
    hostname: '127.0.0.1',
    port: opts.port,
    path: opts.targetPath,
    method: req.method,
    headers,
  }, (upstreamRes) => {
    if (opts.rewriteLocationPrefix &&
        typeof upstreamRes.headers.location === 'string' &&
        upstreamRes.headers.location.startsWith('/') &&
        !upstreamRes.headers.location.startsWith('//')) {
      const loc = upstreamRes.headers.location;
      if (loc !== opts.rewriteLocationPrefix && !loc.startsWith(opts.rewriteLocationPrefix + '/')) {
        upstreamRes.headers.location = opts.rewriteLocationPrefix + loc;
      }
    }
    if (opts.rewriteHtmlPrefix) {
      rewriteAntigravityHtmlStream(upstreamRes, opts.rewriteHtmlPrefix, req.method, antigravityClientBridge);
    }
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    if (req.method === 'HEAD') {
      upstreamRes.resume();
      res.end();
      return;
    }
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    const payload = JSON.stringify({ error: `${opts.label || 'Upstream'} unavailable: ${err.message}` });
    res.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(payload);
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      upstreamReq.destroy();
    }
  });

  if (req.readableEnded) {
    upstreamReq.end();
  } else {
    req.pipe(upstreamReq);
  }
}

function formatRawHttpHeaders(headersObj) {
  const lines = [];
  for (const [k, v] of Object.entries(headersObj || {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) lines.push(`${k}: ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join('\r\n');
}

function forwardWs(req, opts) {
  const clientSocket = req.ws;
  let resumed = false;
  function resumeClient() {
    if (!resumed) {
      resumed = true;
      clientSocket.resume();
    }
  }

  const headers = normalizeForwardedHeaders(req, opts);
  headers.connection = 'Upgrade';
  headers.upgrade = (req.headers && req.headers.upgrade) || 'websocket';
  if (opts.targetOrigin && !headers.origin) {
    headers.origin = opts.targetOrigin;
  }

  const upstreamReq = http.request({
    hostname: '127.0.0.1',
    port: opts.port,
    path: opts.targetPath,
    method: 'GET',
    headers,
  });

  function onEarlyClientClose() {
    if (!upstreamReq.destroyed) upstreamReq.destroy();
  }
  clientSocket.once('close', onEarlyClientClose);

  upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    clientSocket.removeListener('close', onEarlyClientClose);
    const statusLine = `HTTP/${upstreamRes.httpVersion || '1.1'} ${upstreamRes.statusCode || 101} ${upstreamRes.statusMessage || 'Switching Protocols'}`;
    const rawHeaders = formatRawHttpHeaders(upstreamRes.headers);
    clientSocket.write(`${statusLine}\r\n${rawHeaders}\r\n\r\n`);
    if (req.head && req.head.length > 0) {
      upstreamSocket.write(req.head);
    }
    if (upstreamHead && upstreamHead.length > 0) {
      clientSocket.write(upstreamHead);
    }
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
    resumeClient();

    const cleanup = () => {
      upstreamSocket.destroy();
      clientSocket.destroy();
    };
    upstreamSocket.on('error', cleanup);
    clientSocket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('close', () => {
      if (!clientSocket.destroyed) clientSocket.end();
    });
    clientSocket.on('close', () => {
      if (!upstreamSocket.destroyed) upstreamSocket.end();
    });
  });

  upstreamReq.on('response', (upstreamRes) => {
    clientSocket.removeListener('close', onEarlyClientClose);
    const statusLine = `HTTP/${upstreamRes.httpVersion || '1.1'} ${upstreamRes.statusCode || 502} ${upstreamRes.statusMessage || 'Bad Gateway'}`;
    const rawHeaders = formatRawHttpHeaders(upstreamRes.headers);
    clientSocket.write(`${statusLine}\r\n${rawHeaders}\r\n\r\n`);
    upstreamRes.pipe(clientSocket);
    resumeClient();
  });

  upstreamReq.on('error', () => {
    clientSocket.removeListener('close', onEarlyClientClose);
    if (!clientSocket.destroyed) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
    resumeClient();
  });

  upstreamReq.end();
}

function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const encoding = String((req.headers && req.headers['content-encoding']) || '').trim().toLowerCase();
    if (encoding && encoding !== 'identity') {
      const err = new Error('Compressed request bodies are not allowed');
      err.statusCode = 415;
      reject(err);
      return;
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        const err = new Error('Request body too large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const err = new Error('JSON body must be an object');
          err.statusCode = 400;
          reject(err);
          return;
        }
        resolve(parsed);
      } catch (_err) {
        const err = new Error('Invalid JSON body');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function httpGetJson(urlStr, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(urlStr, { agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (body.length < 65536) body += chunk;
      });
      res.on('end', () => {
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch (_err) {}
        resolve({ status: res.statusCode || 0, json, text: body });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
  });
}

function connectRpcJson(port, rpcPath, csrfToken, payload = {}, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: rpcPath,
      method: 'POST',
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrfToken,
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (raw.length <= 2 * 1024 * 1024) raw += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_err) {}
        if (res.statusCode !== 200) {
          const msg = (parsed && parsed.message) || `HTTP ${res.statusCode}`;
          const err = new Error(msg);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        resolve(parsed || {});
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`RPC timeout after ${timeoutMs}ms`));
    });
    req.end(body);
  });
}

function resolveWorkspaceDir(rawDir, defaultWorkspace, allowedRoot) {
  const fallback = fs.existsSync(defaultWorkspace) ? defaultWorkspace : allowedRoot;
  const candidate = (typeof rawDir === 'string' && rawDir.trim()) ? rawDir.trim() : fallback;
  const resolved = path.resolve(candidate);
  const rootResolved = path.resolve(allowedRoot);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    const err = new Error(`工作目录必须位于 ${rootResolved} 内`);
    err.statusCode = 400;
    throw err;
  }
  const realRoot = fs.existsSync(rootResolved) ? fs.realpathSync(rootResolved) : rootResolved;
  if (!fs.existsSync(resolved)) {
    const err = new Error(`工作目录不存在: ${resolved}`);
    err.statusCode = 400;
    throw err;
  }
  const realTarget = fs.realpathSync(resolved);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    const err = new Error(`工作目录越界: ${realTarget}`);
    err.statusCode = 400;
    throw err;
  }
  if (!fs.statSync(realTarget).isDirectory()) {
    const err = new Error(`指定路径不是目录: ${realTarget}`);
    err.statusCode = 400;
    throw err;
  }
  return realTarget;
}

function normalizeTrajectories(rawResp) {
  const summaries = (rawResp && (rawResp.trajectorySummaries || rawResp.trajectory_summaries)) || {};
  const items = [];
  for (const [cascadeId, entry] of Object.entries(summaries)) {
    if (!entry || typeof entry !== 'object') continue;
    const coord = entry.annotations && entry.annotations.coordinator;
    const wsList = Array.isArray(entry.workspaces) ? entry.workspaces : [];
    const firstWs = wsList[0] || {};
    items.push({
      cascadeId,
      trajectoryId: entry.trajectoryId || entry.trajectory_id || '',
      summary: entry.summary || '',
      stepCount: entry.stepCount != null ? entry.stepCount : entry.step_count,
      lastModifiedTime: entry.lastModifiedTime || entry.last_modified_time || '',
      workspaceUri: firstWs.workspaceFolderAbsoluteUri || firstWs.workspace_folder_absolute_uri || '',
      coordinator: coord ? {
        name: coord.name || 'Coordinator',
        goal: coord.goal || '',
        color: coord.color || '',
      } : null,
    });
  }
  items.sort((a, b) => String(b.lastModifiedTime || '').localeCompare(String(a.lastModifiedTime || '')));
  return items.slice(0, 50);
}

class ManagedProcess extends EventEmitter {
  constructor(name, spawnSpecFn) {
    super();
    this.name = name;
    this.spawnSpecFn = spawnSpecFn;
    this.child = null;
    this.disposed = false;
    this.starting = false;
    this.lastError = '';
    this.restartCount = 0;
    this.restartTimer = null;
    this.logs = [];
    this.pendingAuthUrl = '';
  }

  appendLog(source, line) {
    const clean = redactSecrets(line).trim();
    if (!clean) return;
    this.logs.push(`[${source}] ${clean}`);
    if (this.logs.length > 120) this.logs.shift();
    this.emit('change');
  }

  start() {
    if (this.disposed || this.child) return;
    let spec;
    try {
      spec = this.spawnSpecFn();
    } catch (err) {
      this.starting = false;
      this.lastError = err.message;
      this.emit('change');
      return;
    }
    this.starting = true;
    this.lastError = '';
    const child = spawn(spec.bin, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.emit('change');

    const bindStream = (stream, label) => {
      if (!stream) return;
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const rawLine = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (rawLine.startsWith('ANTIGRAVITY_OPEN_URL:')) {
            const rawUrl = rawLine.slice('ANTIGRAVITY_OPEN_URL:'.length).trim();
            if (/^https?:\/\//i.test(rawUrl)) {
              this.pendingAuthUrl = rawUrl;
            }
            this.appendLog(label, 'ANTIGRAVITY_OPEN_URL detected');
          } else {
            this.appendLog(label, rawLine);
          }
        }
      });
    };
    bindStream(child.stdout, 'stdout');
    bindStream(child.stderr, 'stderr');

    child.on('error', (err) => {
      if (this.child !== child) return;
      this.child = null;
      this.starting = false;
      this.lastError = err.message;
      this.appendLog('error', `Failed to spawn ${this.name}: ${err.message}`);
      this.scheduleRestart();
    });

    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.starting = false;
      if (!this.disposed) {
        this.lastError = `${this.name} exited (code=${code}, signal=${signal || 'none'})`;
        this.appendLog('exit', this.lastError);
        this.scheduleRestart();
      }
    });
  }

  scheduleRestart() {
    if (this.disposed || this.restartTimer) return;
    const delayMs = Math.min(1000 * Math.pow(2, this.restartCount), 15000);
    this.restartCount++;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, delayMs);
    if (this.restartTimer.unref) this.restartTimer.unref();
  }

  restart() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.restartCount = 0;
    const old = this.child;
    this.child = null;
    if (old) {
      try { old.kill('SIGTERM'); } catch (_err) {}
    }
    this.start();
  }

  dispose() {
    this.disposed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const old = this.child;
    this.child = null;
    if (old) {
      try { old.kill('SIGTERM'); } catch (_err) {}
      const killTimer = setTimeout(() => {
        try { old.kill('SIGKILL'); } catch (_err) {}
      }, 2000);
      if (killTimer.unref) killTimer.unref();
    }
  }
}

function createAgyConsole(opts = {}) {
  const hubPort = Number(opts.hubPort || process.env.AGY_HUB_PORT || 34500);
  const ttydPort = Number(opts.ttydPort || process.env.AGY_TTYD_PORT || 7681);
  const agyBin = opts.agyBin || process.env.AGY_BIN || '/usr/local/bin/agy';
  const agyshellBin = opts.agyshellBin || process.env.AGYSHELL_BIN || '/usr/local/bin/agyshell';
  const ttydBin = opts.ttydBin || process.env.TTYD_BIN || '/usr/local/bin/ttyd';
  const tmuxConf = opts.tmuxConf || process.env.AGYSHELL_TMUX_CONF || '/etc/agyshell.tmux.conf';
  const tmuxSocket = opts.tmuxSocket || process.env.AGYSHELL_TMUX_SOCKET || 'agy';
  const defaultWorkspace = opts.defaultWorkspace || process.env.DEFAULT_WORKSPACE || '/config/workspace';
  const allowedRoot = opts.allowedRoot || process.env.AGY_ALLOWED_WORKSPACE_ROOT || '/config';
  const sharedIdeHub = (opts.sharedIdeHub !== undefined)
    ? Boolean(opts.sharedIdeHub)
    : (process.env.AGY_SHARED_HUB || '1') !== '0';
  const disableProcesses = Boolean(opts.disableProcesses || process.env.AGY_CONSOLE_DISABLE_SPAWN === '1');
  const csrfToken = opts.csrfToken || crypto.randomUUID();
  const webuiDir = opts.webuiDir || process.env.AGY_WEBUI_DIR ||
    (fs.existsSync('/usr/local/share/agy-webui') ? '/usr/local/share/agy-webui' : path.join(__dirname, 'agy-webui'));

  const wsClients = new Set();
  let pollTimer = null;
  let broadcastTimer = null;
  let cachedCliInfo = null;

  const hubProc = new ManagedProcess('agy-hub', () => {
    const cwd = fs.existsSync(defaultWorkspace) ? defaultWorkspace : os.homedir();
    const env = {
      ...process.env,
      HOME: process.env.HOME || os.homedir(),
      AGY_ENABLE_HUB: '1',
      ANTIGRAVITY_VSCODE_HOST: '1',
      ANTIGRAVITY_REMOTE_OOB_AUTH: '1',
      ANTIGRAVITY_SERVER_CSRF_TOKEN: csrfToken,
    };
    delete env.AGY_REQUIRE_AUTHENTICATED_UI_BOOTSTRAP;
    return {
      bin: agyBin,
      args: ['--hub', `--hub-port=${hubPort}`, '--app_data_dir=antigravity', `--csrf_token=${csrfToken}`],
      cwd,
      env,
    };
  });

  const ttydProc = new ManagedProcess('ttyd', () => {
    const cwd = fs.existsSync(defaultWorkspace) ? defaultWorkspace : os.homedir();
    return {
      bin: ttydBin,
      args: [
        '-i', '127.0.0.1',
        '-p', String(ttydPort),
        '-W',
        '-a',
        '-t', 'titleFixed=AGYShell',
        '-t', 'fontSize=14',
        '-b', '/agy/terminal',
        agyshellBin,
        '--web',
      ],
      cwd,
      env: { ...process.env },
    };
  });

  async function inspectCli() {
    if (disableProcesses && opts.mockCliInfo) return opts.mockCliInfo;
    if (cachedCliInfo && cachedCliInfo.available) return cachedCliInfo;
    try {
      const { stdout, stderr } = await execFileAsync(agyBin, ['--version'], { timeout: 5000 });
      const line = `${stdout} ${stderr}`.trim().split(/\r?\n/)[0] || '';
      const verMatch = line.match(/(\d+\.\d+\.\d+[^\s]*)/);
      cachedCliInfo = { available: true, version: verMatch ? verMatch[1] : line };
    } catch (err) {
      cachedCliInfo = { available: false, version: null, error: err.message };
    }
    return cachedCliInfo;
  }

  async function listTmuxSessions() {
    if (disableProcesses) {
      return { sessions: opts.mockTmuxSessions || [], error: null };
    }
    const args = ['-L', tmuxSocket];
    if (fs.existsSync(tmuxConf)) args.push('-f', tmuxConf);
    args.push('list-sessions', '-F', '#{session_name}\t#{session_path}\t#{session_attached}\t#{session_created}');
    try {
      const { stdout } = await execFileAsync('tmux', args, { timeout: 3000 });
      const sessions = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, cwd, attached, created] = line.split('\t');
          return {
            name: name || '',
            cwd: cwd || '',
            attached: Number(attached || 0),
            createdAt: created ? Number(created) : null,
          };
        })
        .filter((s) => s.name);
      return { sessions, error: null };
    } catch (err) {
      const msg = String(err.stderr || err.message || '');
      if (/no server running|no current|error connecting|failed to connect/i.test(msg)) {
        return { sessions: [], error: null };
      }
      return { sessions: [], error: msg.trim() || err.message };
    }
  }

  async function collectStatus() {
    const cli = await inspectCli();
    const tmuxPromise = listTmuxSessions();

    let hubHealth = { healthy: false, instanceId: null, error: hubProc.lastError || null };
    try {
      const probe = await httpGetJson(`http://127.0.0.1:${hubPort}/healthz`, 2000);
      if (probe.status >= 200 && probe.status < 500) {
        hubHealth = {
          healthy: true,
          instanceId: (probe.json && typeof probe.json.instanceId === 'string') ? probe.json.instanceId : null,
          error: null,
        };
        hubProc.starting = false;
        hubProc.restartCount = 0;
      } else {
        hubHealth.error = `HTTP ${probe.status}`;
      }
    } catch (err) {
      hubHealth.error = hubProc.lastError || err.message;
    }

    let ttydHealth = { healthy: false, error: ttydProc.lastError || null };
    try {
      const probe = await httpGetJson(`http://127.0.0.1:${ttydPort}/agy/terminal/`, 1500);
      if (probe.status >= 200 && probe.status < 500) {
        ttydHealth = { healthy: true, error: null };
        ttydProc.starting = false;
        ttydProc.restartCount = 0;
      } else {
        ttydHealth.error = `HTTP ${probe.status}`;
      }
    } catch (err) {
      ttydHealth.error = ttydProc.lastError || err.message;
    }

    const auth = { checked: false, signedIn: false, projectId: '', location: '', authMode: '', error: null, loginSession: null };
    let user = null;
    const conversations = { items: [], error: null };

    if (hubHealth.healthy) {
      const [authRes, loginRes, userRes, trajRes] = await Promise.allSettled([
        connectRpcJson(hubPort, '/exa.language_server_pb.LanguageServerService/GetAuthStatus', csrfToken, {}),
        connectRpcJson(hubPort, '/exa.language_server_pb.LanguageServerService/GetLoginSession', csrfToken, {}),
        connectRpcJson(hubPort, '/exa.language_server_pb.LanguageServerService/GetUserStatus', csrfToken, {}),
        connectRpcJson(hubPort, '/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories', csrfToken, {}),
      ]);

      if (authRes.status === 'fulfilled') {
        const ar = authRes.value.authResult || authRes.value.auth_result || {};
        auth.checked = true;
        auth.signedIn = Boolean(ar.hasValidAuth || ar.has_valid_auth);
        auth.projectId = ar.projectId || ar.project_id || '';
        auth.location = ar.location || '';
        auth.authMode = ar.authMode || ar.auth_mode || '';
        if (auth.signedIn) hubProc.pendingAuthUrl = '';
      } else {
        auth.error = authRes.reason.message;
      }

      if (loginRes.status === 'fulfilled') {
        const ls = loginRes.value;
        auth.loginSession = {
          active: Boolean(ls.active),
          authUrl: ls.authUrl || ls.auth_url || '',
          mode: ls.mode || '',
        };
      }

      if (userRes.status === 'fulfilled') {
        const us = userRes.value.userStatus || userRes.value.user_status;
        if (us) {
          user = {
            email: us.email || '',
            name: us.name || '',
            userTier: us.userTier || us.user_tier || '',
          };
        }
      }

      if (trajRes.status === 'fulfilled') {
        conversations.items = normalizeTrajectories(trajRes.value);
      } else {
        conversations.error = trajRes.reason.message;
      }
    }

    const tmux = await tmuxPromise;
    return {
      timestamp: new Date().toISOString(),
      cli,
      hub: {
        port: hubPort,
        healthy: hubHealth.healthy,
        starting: !hubHealth.healthy && hubProc.starting,
        instanceId: hubHealth.instanceId,
        pendingAuthUrl: hubProc.pendingAuthUrl,
        error: hubHealth.error,
        logs: hubProc.logs.slice(-60),
      },
      ttyd: {
        port: ttydPort,
        healthy: ttydHealth.healthy,
        error: ttydHealth.error,
      },
      auth,
      user,
      conversations,
      tmux,
      capabilities: {
        nativeSwarmWebUi: true,
        sharedIdeHub,
      },
    };
  }

  function scheduleBroadcast() {
    if (wsClients.size === 0 || broadcastTimer) return;
    broadcastTimer = setTimeout(async () => {
      broadcastTimer = null;
      if (wsClients.size === 0) return;
      try {
        const snapshot = await collectStatus();
        const payload = JSON.stringify({ type: 'snapshot', data: snapshot });
        for (const ws of wsClients) {
          if (ws.readyState === 1) ws.send(payload);
        }
      } catch (_err) {}
    }, 150);
    if (broadcastTimer.unref) broadcastTimer.unref();
  }

  hubProc.on('change', scheduleBroadcast);
  ttydProc.on('change', scheduleBroadcast);

  function startPollLoop() {
    if (pollTimer || wsClients.size === 0) return;
    pollTimer = setInterval(() => {
      if (wsClients.size === 0) {
        clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      scheduleBroadcast();
    }, 3000);
    if (pollTimer.unref) pollTimer.unref();
  }

  function registerRoutes(app, _args, deps) {
    if (!disableProcesses) {
      hubProc.start();
      ttydProc.start();
    }

    function sendJson(res, status, data) {
      res.status(status);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(data));
    }

    function sendStaticFile(res, fileName, contentType) {
      const fullPath = path.join(webuiDir, fileName);
      if (!fs.existsSync(fullPath)) {
        sendJson(res, 404, { error: `Asset not found: ${fileName}` });
        return;
      }
      const content = fs.readFileSync(fullPath);
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.end(content);
    }

    app.router.use('/agy', (req, res, next) => {
      (async () => {
        const subPath = req.path || '/';
        const origRaw = req.originalUrl || req.url || '/agy/';
        const qIdx = origRaw.indexOf('?');
        const origPath = qIdx === -1 ? origRaw : origRaw.slice(0, qIdx);
        const origSearch = qIdx === -1 ? '' : origRaw.slice(qIdx);

        const isAuthed = await deps.http.authenticated(req);
        if (!isAuthed) {
          const isPageGet = (req.method === 'GET' || req.method === 'HEAD') &&
            (subPath === '/' || subPath === '/hub' || subPath === '/hub/' || subPath === '/terminal' || subPath === '/terminal/');
          if (isPageGet) {
            deps.http.redirect(req, res, 'login', { to: origRaw });
            return;
          }
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        if (subPath === '/' && origPath.endsWith('/agy') && (req.method === 'GET' || req.method === 'HEAD')) {
          res.redirect(302, origPath + '/' + origSearch);
          return;
        }

        if (req.method === 'GET' || req.method === 'HEAD') {
          if (subPath === '/') {
            sendStaticFile(res, 'index.html', 'text/html; charset=utf-8');
            return;
          }
          if (subPath === '/assets/styles.css') {
            sendStaticFile(res, 'styles.css', 'text/css; charset=utf-8');
            return;
          }
          if (subPath === '/assets/app.js') {
            sendStaticFile(res, 'app.js', 'application/javascript; charset=utf-8');
            return;
          }
          if (subPath === '/api/status') {
            sendJson(res, 200, await collectStatus());
            return;
          }
        }

        if (req.method === 'POST' && subPath === '/api/sessions') {
          deps.http.ensureOrigin(req);
          const body = await readJsonBody(req);
          let name;
          if (body.name !== undefined && body.name !== null && String(body.name).trim() !== '') {
            name = String(body.name).trim();
            if (!SESSION_NAME_RE.test(name)) {
              sendJson(res, 400, { error: '无效会话名：仅限 1-48 位字母、数字、点、下划线或连字符' });
              return;
            }
          }
          const cwd = resolveWorkspaceDir(body.cwd, defaultWorkspace, allowedRoot);
          const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
          const finalPrompt = rawPrompt
            ? (body.swarm && !rawPrompt.startsWith('/swarm') ? `/swarm ${rawPrompt}` : rawPrompt)
            : '';
          const cliArgs = ['-d', '-c', cwd];
          if (name) cliArgs.push('-s', name);
          if (finalPrompt) cliArgs.push('--', '-i', finalPrompt);

          if (disableProcesses && typeof opts.mockCreateSession === 'function') {
            const created = await opts.mockCreateSession({ name, cwd, prompt: finalPrompt, cliArgs });
            scheduleBroadcast();
            sendJson(res, 201, { ok: true, sessionName: created.sessionName || name || 'workspace', cwd });
            return;
          }

          try {
            const { stdout } = await execFileAsync(agyshellBin, cliArgs, { timeout: 10000 });
            const sessionName = stdout.trim().split(/\r?\n/).pop() || name || 'workspace';
            scheduleBroadcast();
            sendJson(res, 201, { ok: true, sessionName, cwd });
          } catch (err) {
            const msg = String(err.stderr || err.message || '启动会话失败').trim();
            sendJson(res, 500, { error: msg });
          }
          return;
        }

        const killMatch = req.method === 'POST' && /^\/api\/sessions\/([^/]+)\/kill$/.exec(subPath);
        if (killMatch) {
          deps.http.ensureOrigin(req);
          const targetName = decodeURIComponent(killMatch[1]);
          if (!SESSION_NAME_RE.test(targetName)) {
            sendJson(res, 400, { error: '无效会话名' });
            return;
          }
          if (disableProcesses && typeof opts.mockKillSession === 'function') {
            await opts.mockKillSession(targetName);
          } else {
            try {
              await execFileAsync(agyshellBin, ['kill', targetName], { timeout: 5000 });
            } catch (err) {
              const msg = String(err.stderr || err.message || '终止会话失败').trim();
              sendJson(res, /不存在/.test(msg) ? 404 : 500, { error: msg });
              return;
            }
          }
          scheduleBroadcast();
          sendJson(res, 200, { ok: true, sessionName: targetName });
          return;
        }

        if (req.method === 'POST' && subPath === '/api/hub/restart') {
          deps.http.ensureOrigin(req);
          if (!disableProcesses) {
            hubProc.restart();
          }
          scheduleBroadcast();
          sendJson(res, 200, { ok: true });
          return;
        }

        if (subPath === '/hub' || subPath.startsWith('/hub/')) {
          if (origPath.endsWith('/agy/hub') && (req.method === 'GET' || req.method === 'HEAD')) {
            res.redirect(302, origPath + '/' + origSearch);
            return;
          }
          const info = parseSubProxyPath(origRaw, 'agy\\/hub');
          if (!info) {
            sendJson(res, 400, { error: 'Invalid /agy/hub path' });
            return;
          }
          forwardHttp(req, res, {
            port: hubPort,
            targetPath: info.tailPath + info.search,
            targetHostHeader: `localhost:${hubPort}`,
            targetOrigin: `http://localhost:${hubPort}`,
            rewriteHtmlPrefix: info.prefix,
            rewriteLocationPrefix: info.prefix,
            cookieSessionName: req.cookieSessionName,
            label: 'Antigravity Hub',
          });
          return;
        }

        if (subPath === '/terminal' || subPath.startsWith('/terminal/')) {
          if (origPath.endsWith('/agy/terminal') && (req.method === 'GET' || req.method === 'HEAD')) {
            res.redirect(302, origPath + '/' + origSearch);
            return;
          }
          const info = parseSubProxyPath(origRaw, 'agy\\/terminal');
          if (!info) {
            sendJson(res, 400, { error: 'Invalid /agy/terminal path' });
            return;
          }
          forwardHttp(req, res, {
            port: ttydPort,
            targetPath: '/agy/terminal' + info.tailPath + info.search,
            targetHostHeader: `127.0.0.1:${ttydPort}`,
            targetOrigin: `http://127.0.0.1:${ttydPort}`,
            cookieSessionName: req.cookieSessionName,
            label: 'AGYShell ttyd',
          });
          return;
        }

        sendJson(res, 404, { error: 'Not Found' });
      })().catch(next);
    });

    const agyWs = deps.wsRouter.Router();

    agyWs.ws(/^\/agy\/ws\/?$/, async (req) => {
      deps.http.ensureOrigin(req);
      await deps.http.ensureAuthenticated(req);
      deps.wsRouter.wss.handleUpgrade(req, req.ws, req.head, async (ws) => {
        req.ws.resume();
        wsClients.add(ws);
        startPollLoop();
        ws.on('close', () => wsClients.delete(ws));
        ws.on('error', () => wsClients.delete(ws));
        try {
          const snapshot = await collectStatus();
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));
          }
        } catch (_err) {}
      });
    });

    agyWs.ws(/^\/agy\/hub(?:\/|$)/, async (req) => {
      deps.http.ensureOrigin(req);
      await deps.http.ensureAuthenticated(req);
      const info = parseSubProxyPath(req.originalUrl || req.url, 'agy\\/hub');
      if (!info) {
        req.ws.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        req.ws.resume();
        return;
      }
      forwardWs(req, {
        port: hubPort,
        targetPath: info.tailPath + info.search,
        targetHostHeader: `localhost:${hubPort}`,
        targetOrigin: `http://localhost:${hubPort}`,
        cookieSessionName: req.cookieSessionName,
      });
    });

    agyWs.ws(/^\/agy\/terminal(?:\/|$)/, async (req) => {
      deps.http.ensureOrigin(req);
      await deps.http.ensureAuthenticated(req);
      const info = parseSubProxyPath(req.originalUrl || req.url, 'agy\\/terminal');
      if (!info) {
        req.ws.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        req.ws.resume();
        return;
      }
      forwardWs(req, {
        port: ttydPort,
        targetPath: '/agy/terminal' + info.tailPath + info.search,
        targetHostHeader: `127.0.0.1:${ttydPort}`,
        targetOrigin: `http://127.0.0.1:${ttydPort}`,
        cookieSessionName: req.cookieSessionName,
      });
    });

    app.wsRouter.use(agyWs.router);

    return { dispose };
  }

  function dispose() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
    }
    for (const ws of wsClients) {
      try { ws.close(); } catch (_err) {}
    }
    wsClients.clear();
    hubProc.dispose();
    ttydProc.dispose();
  }

  return {
    registerRoutes,
    dispose,
    collectStatus,
    hubProc,
    ttydProc,
    _internals: {
      redactSecrets,
      stripCookieHeader,
      parseSubProxyPath,
      resolveWorkspaceDir,
      normalizeTrajectories,
    },
  };
}

let defaultInstance = null;

function registerRoutes(app, args, deps, opts) {
  if (!defaultInstance) {
    defaultInstance = createAgyConsole(opts);
  }
  return defaultInstance.registerRoutes(app, args, deps);
}

function dispose() {
  if (defaultInstance) {
    defaultInstance.dispose();
    defaultInstance = null;
  }
}

module.exports = {
  createAgyConsole,
  registerRoutes,
  dispose,
};
