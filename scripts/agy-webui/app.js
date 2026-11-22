(() => {
  'use strict';

  const state = {
    activeTab: 'workbench',
    status: null,
    wsConnected: false,
    hubFrameLoadedHealthy: false,
    termLoadedSession: null,
    termLoadedHealthy: false,
    tipDismissed: false,
    collapsed: false,
  };

  const els = {
    topbar: document.getElementById('topbar'),
    wsDot: document.getElementById('ws-dot'),
    pillCli: document.getElementById('pill-cli'),
    pillHub: document.getElementById('pill-hub'),
    pillAuth: document.getElementById('pill-auth'),
    badgeSessions: document.getElementById('badge-sessions'),
    tabs: Array.from(document.querySelectorAll('.tab[data-tab]')),
    btnCollapse: document.getElementById('btn-collapse-bar'),
    btnExpand: document.getElementById('btn-expand-bar'),
    authBanner: document.getElementById('auth-banner'),
    authBannerHint: document.getElementById('auth-banner-hint'),
    authBannerLink: document.getElementById('auth-banner-link'),
    btnCopyAuthUrl: document.getElementById('btn-copy-auth-url'),
    panels: {
      workbench: document.getElementById('panel-workbench'),
      sessions: document.getElementById('panel-sessions'),
      terminal: document.getElementById('panel-terminal'),
    },
    swarmTip: document.getElementById('swarm-tip'),
    btnReloadHub: document.getElementById('btn-reload-hub'),
    btnDismissTip: document.getElementById('btn-dismiss-tip'),
    hubMask: document.getElementById('hub-offline-mask'),
    hubMaskTitle: document.getElementById('hub-mask-title'),
    hubMaskDesc: document.getElementById('hub-mask-desc'),
    btnRetryHubFrame: document.getElementById('btn-retry-hub-frame'),
    btnGotoTerminal: document.getElementById('btn-goto-terminal'),
    hubFrame: document.getElementById('hub-frame'),
    launchForm: document.getElementById('launch-form'),
    taskPrompt: document.getElementById('task-prompt'),
    taskCwd: document.getElementById('task-cwd'),
    taskName: document.getElementById('task-name'),
    taskSwarm: document.getElementById('task-swarm'),
    btnLaunchSession: document.getElementById('btn-launch-session'),
    btnOpenWorkbench: document.getElementById('btn-open-workbench'),
    launchFeedback: document.getElementById('launch-feedback'),
    hubConvSource: document.getElementById('hub-conv-source'),
    hubConvList: document.getElementById('hub-conversations-list'),
    tmuxList: document.getElementById('tmux-sessions-list'),
    btnNewEmptyShell: document.getElementById('btn-new-empty-shell'),
    btnRestartHub: document.getElementById('btn-restart-hub'),
    capGrid: document.getElementById('capabilities-grid'),
    hubLogs: document.getElementById('hub-logs'),
    termSelect: document.getElementById('term-session-select'),
    btnTermConnect: document.getElementById('btn-term-connect'),
    btnTermNew: document.getElementById('btn-term-new'),
    termMask: document.getElementById('term-offline-mask'),
    termMaskDesc: document.getElementById('term-mask-desc'),
    btnRetryTermFrame: document.getElementById('btn-retry-term-frame'),
    termFrame: document.getElementById('term-frame'),
  };

  function setPill(el, text, level) {
    el.textContent = text;
    el.classList.remove('ok', 'warn', 'err');
    if (level) el.classList.add(level);
  }

  function showFeedback(text, isError) {
    els.launchFeedback.textContent = text;
    els.launchFeedback.classList.remove('hidden', 'ok', 'err');
    els.launchFeedback.classList.add(isError ? 'err' : 'ok');
  }

  function switchTab(tabName) {
    if (!els.panels[tabName]) return;
    state.activeTab = tabName;
    for (const tab of els.tabs) {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const [name, panel] of Object.entries(els.panels)) {
      panel.classList.toggle('hidden', name !== tabName);
      panel.classList.toggle('panel-active', name === tabName);
    }
    if (tabName === 'terminal' && !state.termLoadedSession) {
      loadTerminalSession(els.termSelect.value || 'workspace', false);
    }
  }

  function loadTerminalSession(sessionName, forceReload) {
    const name = sessionName || 'workspace';
    els.termSelect.value = name;
    const ttydHealthy = Boolean(state.status && state.status.ttyd && state.status.ttyd.healthy);
    if (!ttydHealthy) {
      els.termMask.classList.remove('hidden');
      const errMsg = state.status && state.status.ttyd && state.status.ttyd.error;
      els.termMaskDesc.textContent = errMsg ? ('终端服务未就绪：' + errMsg) : '正在等待内部 ttyd 服务就绪...';
      return;
    }
    els.termMask.classList.add('hidden');
    if (forceReload || state.termLoadedSession !== name || !state.termLoadedHealthy) {
      state.termLoadedSession = name;
      state.termLoadedHealthy = true;
      els.termFrame.src = './terminal/?arg=' + encodeURIComponent(name);
    }
  }

  function openHubRoute(subPath) {
    const clean = String(subPath || '').replace(/^\/+/, '');
    els.hubFrame.src = './hub/' + clean;
    switchTab('workbench');
  }

  function formatTime(isoOrEpoch) {
    if (!isoOrEpoch) return '未知';
    const d = typeof isoOrEpoch === 'number'
      ? new Date(isoOrEpoch * 1000)
      : new Date(isoOrEpoch);
    if (Number.isNaN(d.getTime())) return String(isoOrEpoch);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function renderConversations(data) {
    els.hubConvList.textContent = '';
    const convInfo = data.conversations || {};
    const hub = data.hub || {};

    if (!hub.healthy) {
      els.hubConvSource.textContent = 'Hub 未就绪';
      const box = document.createElement('div');
      box.className = 'empty-state';
      box.textContent = hub.error ? ('Hub 当前不可用：' + hub.error) : 'Hub 正在启动，稍后将自动读取真实对话列表。';
      els.hubConvList.appendChild(box);
      return;
    }

    if (convInfo.error) {
      els.hubConvSource.textContent = 'RPC 受限 / 错误';
      const box = document.createElement('div');
      box.className = 'empty-state';
      box.textContent = '读取 Hub 对话列表失败（未伪造数据）：' + convInfo.error;
      els.hubConvList.appendChild(box);
      return;
    }

    const items = Array.isArray(convInfo.items) ? convInfo.items : [];
    els.hubConvSource.textContent = 'RPC: GetAllCascadeTrajectories (' + items.length + ')';

    if (items.length === 0) {
      const box = document.createElement('div');
      box.className = 'empty-state';
      box.textContent = '当前暂无历史对话；可在图形工作台或上方表单发起新任务。';
      els.hubConvList.appendChild(box);
      return;
    }

    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'item-card';

      const main = document.createElement('div');
      main.className = 'item-main';

      const titleRow = document.createElement('div');
      titleRow.className = 'item-title';
      if (item.coordinator) {
        const tag = document.createElement('span');
        tag.className = 'tag-coord';
        tag.textContent = 'Swarm: ' + (item.coordinator.name || 'Coordinator');
        titleRow.appendChild(tag);
      }
      const titleText = document.createElement('span');
      titleText.textContent = item.summary || ('会话 ' + item.cascadeId.slice(0, 8));
      titleRow.appendChild(titleText);

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const parts = [
        'ID: ' + item.cascadeId.slice(0, 12),
        '步骤: ' + (item.stepCount != null ? item.stepCount : '-'),
        '更新: ' + formatTime(item.lastModifiedTime),
      ];
      if (item.workspaceUri) {
        parts.push('目录: ' + item.workspaceUri.replace(/^file:\/\//, ''));
      }
      if (item.coordinator && item.coordinator.goal) {
        parts.push('目标: ' + item.coordinator.goal);
      }
      meta.textContent = parts.join(' | ');

      main.appendChild(titleRow);
      main.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn btn-primary btn-xs';
      openBtn.textContent = '在图形工作台打开';
      openBtn.addEventListener('click', () => {
        openHubRoute('c/' + encodeURIComponent(item.cascadeId));
      });
      actions.appendChild(openBtn);

      card.appendChild(main);
      card.appendChild(actions);
      els.hubConvList.appendChild(card);
    }
  }

  function renderTmuxSessions(data) {
    els.tmuxList.textContent = '';
    const tmuxInfo = data.tmux || {};
    const sessions = Array.isArray(tmuxInfo.sessions) ? tmuxInfo.sessions : [];

    // Keep terminal dropdown synced without losing current user choice.
    const prevValue = els.termSelect.value || 'workspace';
    els.termSelect.textContent = '';
    const seen = new Set();
    for (const s of sessions) {
      seen.add(s.name);
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name + (s.cwd ? ' (' + s.cwd + ')' : '');
      els.termSelect.appendChild(opt);
    }
    if (!seen.has('workspace')) {
      const opt = document.createElement('option');
      opt.value = 'workspace';
      opt.textContent = 'workspace（默认工作区）';
      els.termSelect.appendChild(opt);
    }
    els.termSelect.value = seen.has(prevValue) || prevValue === 'workspace' ? prevValue : (sessions[0]?.name || 'workspace');

    if (tmuxInfo.error) {
      const box = document.createElement('div');
      box.className = 'empty-state';
      box.textContent = 'tmux 查询异常：' + tmuxInfo.error;
      els.tmuxList.appendChild(box);
      return;
    }

    if (sessions.length === 0) {
      const box = document.createElement('div');
      box.className = 'empty-state';
      box.textContent = '当前没有运行中的后台 agyshell 会话。';
      els.tmuxList.appendChild(box);
      return;
    }

    for (const s of sessions) {
      const card = document.createElement('div');
      card.className = 'item-card';

      const main = document.createElement('div');
      main.className = 'item-main';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = s.name + (s.attached > 0 ? '（已连接 ' + s.attached + ' 个客户端）' : '（后台运行中）');

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = '目录: ' + (s.cwd || '未知') + ' | 创建: ' + formatTime(s.createdAt);

      main.appendChild(title);
      main.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'item-actions';

      const attachBtn = document.createElement('button');
      attachBtn.type = 'button';
      attachBtn.className = 'btn btn-primary btn-xs';
      attachBtn.textContent = '连接终端';
      attachBtn.addEventListener('click', () => {
        switchTab('terminal');
        loadTerminalSession(s.name, true);
      });

      const killBtn = document.createElement('button');
      killBtn.type = 'button';
      killBtn.className = 'btn btn-danger btn-xs';
      killBtn.textContent = '终止';
      killBtn.addEventListener('click', async () => {
        if (!window.confirm('确定结束后台会话 "' + s.name + '" 吗？正在运行的进程会被终止。')) return;
        killBtn.disabled = true;
        try {
          const resp = await fetch('./api/sessions/' + encodeURIComponent(s.name) + '/kill', { method: 'POST' });
          const body = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            showFeedback(body.error || ('终止失败 (HTTP ' + resp.status + ')'), true);
          } else {
            showFeedback('已终止会话: ' + s.name, false);
            await refreshStatus();
          }
        } catch (err) {
          showFeedback('终止请求异常: ' + err.message, true);
        } finally {
          killBtn.disabled = false;
        }
      });

      actions.appendChild(attachBtn);
      actions.appendChild(killBtn);
      card.appendChild(main);
      card.appendChild(actions);
      els.tmuxList.appendChild(card);
    }
  }

  function renderCapabilities(data) {
    els.capGrid.textContent = '';
    const cli = data.cli || {};
    const hub = data.hub || {};
    const ttyd = data.ttyd || {};
    const auth = data.auth || {};
    const caps = data.capabilities || {};
    const items = [
      {
        name: 'Antigravity CLI (agy)',
        detail: cli.available ? ('已安装 ' + (cli.version || '未知版本')) : ('不可用: ' + (cli.error || '未找到可执行文件')),
      },
      {
        name: '共享 Hub 引擎 (--hub)',
        detail: hub.healthy
          ? ('运行中 · 127.0.0.1:' + hub.port + (caps.sharedIdeHub ? '（与 IDE 侧栏实时共享）' : '（独立模式）'))
          : ('未就绪: ' + (hub.error || '启动中')),
      },
      {
        name: 'Google 账号登录',
        detail: auth.signedIn
          ? ('已登录' + (data.user && data.user.email ? ' (' + data.user.email + ')' : '') + (auth.projectId ? ' · Project: ' + auth.projectId : ''))
          : (auth.checked ? '未登录（请在图形工作台或 agyshell 完成授权）' : ('状态未知: ' + (auth.error || '等待 Hub'))),
      },
      {
        name: 'Web 终端 (ttyd + tmux)',
        detail: ttyd.healthy
          ? ('运行中 · 127.0.0.1:' + ttyd.port + ' · 支持 /swarm board 与 Alt+S')
          : ('未就绪: ' + (ttyd.error || '启动中')),
      },
      {
        name: '结构化 Swarm 面板边界',
        detail: caps.nativeSwarmWebUi
          ? '完整 Swarm 实时面板（Board / Members / Graph）由官方 Hub 工作台直接提供；任务中心额外读取真实对话列表与 tmux 会话。'
          : '仅支持基础状态查看。',
      },
      {
        name: '出站网络代理',
        detail: data.proxy && data.proxy.enabled
          ? ('已启用 (' + data.proxy.proxyUrl + ' · 来源: ' + (data.proxy.source === 'vscode-settings' ? 'VS Code http.proxy' : '容器环境变量') + ' · NO_PROXY 已含环回)')
          : '直连模式（如需走代理，可在 Docker 环境变量设置 HTTP_PROXY/HTTPS_PROXY 或在 VS Code 设置 http.proxy 后重启 Hub）',
      },
    ];
    for (const item of items) {
      const box = document.createElement('div');
      box.className = 'cap-item';
      const title = document.createElement('div');
      title.className = 'cap-name';
      title.textContent = item.name;
      const detail = document.createElement('div');
      detail.className = 'cap-detail';
      detail.textContent = item.detail;
      box.appendChild(title);
      box.appendChild(detail);
      els.capGrid.appendChild(box);
    }

    const logs = Array.isArray(hub.logs) ? hub.logs : [];
    els.hubLogs.textContent = logs.length > 0 ? logs.join('\n') : '暂无 Hub 日志。';
  }

  function applyStatus(data) {
    if (!data || typeof data !== 'object') return;
    state.status = data;

    const cli = data.cli || {};
    const hub = data.hub || {};
    const auth = data.auth || {};
    const ttyd = data.ttyd || {};

    if (cli.available) {
      setPill(els.pillCli, 'CLI ' + (cli.version || 'OK'), 'ok');
    } else {
      setPill(els.pillCli, 'CLI 不可用', 'err');
    }

    if (hub.healthy) {
      setPill(els.pillHub, 'Hub 在线', 'ok');
      els.hubMask.classList.add('hidden');
      if (!state.hubFrameLoadedHealthy) {
        state.hubFrameLoadedHealthy = true;
        if (!els.hubFrame.getAttribute('src')) {
          els.hubFrame.src = './hub/';
        } else {
          // Reload once when transitioning from offline mask to healthy Hub.
          els.hubFrame.src = els.hubFrame.src;
        }
      }
    } else {
      setPill(els.pillHub, hub.starting ? 'Hub 启动中' : 'Hub 异常', hub.starting ? 'warn' : 'err');
      els.hubMask.classList.remove('hidden');
      els.hubMaskTitle.textContent = hub.starting ? 'Antigravity Hub 正在启动...' : 'Antigravity Hub 当前不可用';
      els.hubMaskDesc.textContent = hub.error
        ? ('错误信息：' + hub.error + '。可点击重试，或先使用 Web 终端 (agyshell)。')
        : '正在等待后台 agy --hub 通过健康检查，就绪后会自动加载图形工作台。';
      state.hubFrameLoadedHealthy = false;
    }

    if (auth.signedIn) {
      const label = data.user && data.user.email ? ('已登录: ' + data.user.email) : '已登录';
      setPill(els.pillAuth, label, 'ok');
    } else if (auth.checked) {
      setPill(els.pillAuth, '未登录 Google', 'warn');
    } else {
      setPill(els.pillAuth, '登录状态未知', 'warn');
    }

    const pendingUrl = hub.pendingAuthUrl || (auth.loginSession && auth.loginSession.authUrl) || '';
    if (pendingUrl && !auth.signedIn) {
      els.authBanner.classList.remove('hidden');
      els.authBannerLink.href = pendingUrl;
      els.authBannerHint.textContent = '请在新窗口打开链接完成 Google OAuth 登录（若显示授权码，请复制粘贴回工作台或终端）。';
    } else {
      els.authBanner.classList.add('hidden');
    }

    if (ttyd.healthy && state.activeTab === 'terminal' && !state.termLoadedHealthy) {
      loadTerminalSession(els.termSelect.value || 'workspace', true);
    } else if (!ttyd.healthy) {
      state.termLoadedHealthy = false;
      if (state.activeTab === 'terminal') {
        els.termMask.classList.remove('hidden');
        els.termMaskDesc.textContent = ttyd.error ? ('终端服务未就绪：' + ttyd.error) : '正在等待内部 ttyd 服务就绪。';
      }
    }

    const tmuxCount = Array.isArray(data.tmux && data.tmux.sessions) ? data.tmux.sessions.length : 0;
    const convCount = Array.isArray(data.conversations && data.conversations.items) ? data.conversations.items.length : 0;
    els.badgeSessions.textContent = String(tmuxCount + convCount);

    renderConversations(data);
    renderTmuxSessions(data);
    renderCapabilities(data);
  }

  async function refreshStatus() {
    try {
      const resp = await fetch('./api/status', { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      applyStatus(data);
    } catch (err) {
      setPill(els.pillHub, '状态获取失败', 'err');
      console.warn('[agy-webui] refreshStatus failed:', err);
    }
  }

  function connectWs() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = window.location.pathname.endsWith('/') ? window.location.pathname : (window.location.pathname + '/');
    const url = proto + '//' + window.location.host + base + 'ws';
    let retryMs = 1500;

    function openSocket() {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => {
        state.wsConnected = true;
        retryMs = 1500;
        els.wsDot.classList.remove('offline');
        els.wsDot.classList.add('online');
      });
      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.type === 'snapshot' && msg.data) {
            applyStatus(msg.data);
          }
        } catch (_err) {}
      });
      ws.addEventListener('close', () => {
        state.wsConnected = false;
        els.wsDot.classList.remove('online');
        els.wsDot.classList.add('offline');
        window.setTimeout(openSocket, retryMs);
        retryMs = Math.min(retryMs * 1.5, 10000);
      });
      ws.addEventListener('error', () => {
        try { ws.close(); } catch (_err) {}
      });
    }

    openSocket();
  }

  async function createSession(opts) {
    const resp = await fetch('./api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(body.error || ('创建会话失败 (HTTP ' + resp.status + ')'));
    }
    return body;
  }

  // Wire UI event listeners.
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }

  els.btnCollapse.addEventListener('click', () => {
    state.collapsed = true;
    els.topbar.classList.add('hidden');
    els.btnExpand.classList.remove('hidden');
  });

  els.btnExpand.addEventListener('click', () => {
    state.collapsed = false;
    els.topbar.classList.remove('hidden');
    els.btnExpand.classList.add('hidden');
  });

  els.btnDismissTip.addEventListener('click', () => {
    state.tipDismissed = true;
    els.swarmTip.classList.add('hidden');
  });

  els.btnReloadHub.addEventListener('click', () => {
    els.hubFrame.src = './hub/';
  });

  els.btnRetryHubFrame.addEventListener('click', () => {
    refreshStatus();
    els.hubFrame.src = './hub/';
  });

  els.btnGotoTerminal.addEventListener('click', () => {
    switchTab('terminal');
  });

  els.btnCopyAuthUrl.addEventListener('click', async () => {
    const url = els.authBannerLink.href;
    if (!url || url === '#') return;
    try {
      await navigator.clipboard.writeText(url);
      els.btnCopyAuthUrl.textContent = '已复制';
      window.setTimeout(() => { els.btnCopyAuthUrl.textContent = '复制链接'; }, 2000);
    } catch (_err) {
      window.prompt('请手动复制登录链接:', url);
    }
  });

  els.launchForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const prompt = els.taskPrompt.value.trim();
    const cwd = els.taskCwd.value.trim() || '/config/workspace';
    const name = els.taskName.value.trim();
    const swarm = Boolean(els.taskSwarm.checked);
    if (!prompt) {
      showFeedback('请输入任务描述（如只需空白终端请点击“新建空白终端”）。', true);
      return;
    }
    els.btnLaunchSession.disabled = true;
    try {
      const res = await createSession({ name: name || undefined, cwd, prompt, swarm });
      showFeedback('已启动后台 agyshell 会话: ' + res.sessionName + '，正在切换到 Web 终端...', false);
      els.taskPrompt.value = '';
      await refreshStatus();
      switchTab('terminal');
      loadTerminalSession(res.sessionName, true);
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      els.btnLaunchSession.disabled = false;
    }
  });

  els.btnOpenWorkbench.addEventListener('click', async () => {
    const prompt = els.taskPrompt.value.trim();
    if (prompt) {
      const fullPrompt = els.taskSwarm.checked && !prompt.startsWith('/swarm')
        ? ('/swarm ' + prompt)
        : prompt;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullPrompt).catch(() => {});
      }
      showFeedback('已跳转到图形工作台（任务内容已尝试复制到剪贴板，直接在输入框粘贴发送即可）。', false);
    }
    switchTab('workbench');
  });

  els.btnNewEmptyShell.addEventListener('click', async () => {
    const name = window.prompt('请输入新会话名称（留空则按工作目录自动命名）：', '');
    if (name === null) return;
    const cwd = els.taskCwd.value.trim() || '/config/workspace';
    try {
      const res = await createSession({ name: name.trim() || undefined, cwd });
      showFeedback('已创建会话: ' + res.sessionName, false);
      await refreshStatus();
      switchTab('terminal');
      loadTerminalSession(res.sessionName, true);
    } catch (err) {
      showFeedback(err.message, true);
    }
  });

  els.btnRestartHub.addEventListener('click', async () => {
    if (!window.confirm('确定重启 Antigravity Hub 后台进程吗？当前正在进行的连接会短暂重连。')) return;
    els.btnRestartHub.disabled = true;
    try {
      const resp = await fetch('./api/hub/restart', { method: 'POST' });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || ('HTTP ' + resp.status));
      showFeedback('已触发 Hub 重启，请等待几秒自动恢复。', false);
      state.hubFrameLoadedHealthy = false;
      await refreshStatus();
    } catch (err) {
      showFeedback('重启 Hub 失败: ' + err.message, true);
    } finally {
      els.btnRestartHub.disabled = false;
    }
  });

  els.btnTermConnect.addEventListener('click', () => {
    loadTerminalSession(els.termSelect.value || 'workspace', true);
  });

  els.btnRetryTermFrame.addEventListener('click', () => {
    refreshStatus();
    loadTerminalSession(els.termSelect.value || 'workspace', true);
  });

  els.btnTermNew.addEventListener('click', async () => {
    const name = window.prompt('请输入新终端会话名（字母/数字/._-）：', 'swarm-' + Math.floor(Date.now() / 1000).toString().slice(-4));
    if (!name || !name.trim()) return;
    try {
      const res = await createSession({ name: name.trim(), cwd: els.taskCwd.value.trim() || '/config/workspace' });
      await refreshStatus();
      loadTerminalSession(res.sessionName, true);
    } catch (err) {
      window.alert(err.message);
    }
  });

  // Boot
  refreshStatus();
  connectWs();
})();
