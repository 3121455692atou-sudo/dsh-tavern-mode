export async function api(path, value) {
  const response = await fetch('/api/tavern' + path, value === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error ?? `请求失败：${response.status}`);
  return result;
}

export function createBrowserRuntime(ctx) {
  const controllers = new Map(), snapshots = new Map(), listeners = new Map(), refreshes = new Map();
  const empty = Object.freeze({ payload: null, error: null, loaded: false, ready: false });
  let bootstrap, view, disposed = false;
  function layoutOverlays() {
    for (const controller of controllers.values()) {
      const frame = controller.frame;
      if (!frame) continue;
      const active = view?.id === controller.id && view.element.isConnected;
      const bounds = active ? view.element.getBoundingClientRect() : null;
      if (bounds) Object.assign(frame.style, { left: bounds.left + 'px', top: bounds.top + 'px', width: bounds.width + 'px', height: bounds.height + 'px' });
      const rectangles = active ? (controller.rectangles ?? []).filter(rect => ['left', 'top', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0) : [];
      frame.style.clipPath = rectangles.length ? `path("${rectangles.map(rect => `M${rect.left} ${rect.top}h${rect.width}v${rect.height}h${-rect.width}Z`).join(' ')}")` : 'inset(100%)';
      frame.setAttribute('aria-hidden', String(rectangles.length === 0));
    }
  }
  let overlayFrame;
  const viewportObserver = new ResizeObserver(() => {
    overlayFrame ??= requestAnimationFrame(() => { overlayFrame = undefined; layoutOverlays(); });
  });
  function theme() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:fixed;visibility:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)';
    document.body.append(probe); const style = getComputedStyle(probe);
    const dark = document.body.hasAttribute('data-ds-dark-theme');
    const value = {
      color: style.color, background: style.backgroundColor, bubble: style.backgroundColor, fontFamily: getComputedStyle(document.body).fontFamily,
      viewportHeight: window.innerHeight, scheme: dark ? 'dark' : 'light',
    };
    probe.remove(); return value;
  }
  async function loadBootstrap(refresh = false) { if (!bootstrap || refresh) bootstrap = await api('/bootstrap'); return bootstrap; }
  function publish(id, value) { snapshots.set(id, { ...snapshots.get(id), ...value }); for (const callback of listeners.get(id) ?? []) callback(); }
  function input(id) { const scope = ctx.sessions.scope(id); return scope && ctx.conversation.input.for(scope); }
  function report(id, message) { publish(id, { error: message }); input(id)?.notify('error', message); }
  function refresh(id, remount = false) {
    if (disposed) return Promise.resolve();
    if (refreshes.has(id)) return refreshes.get(id).then(() => refresh(id, remount));
    const pending = refreshNow(id, remount).finally(() => refreshes.delete(id));
    refreshes.set(id, pending); return pending;
  }
  async function refreshNow(id, remount = false) {
    const controller = controllers.get(id);
    const payload = await api('/native-state?id=' + encodeURIComponent(id));
    if (disposed || controllers.get(id) !== controller || controller?.disposed) return;
    if (!payload.state) { publish(id, { payload: null, error: null, loaded: true }); return; }
    if (snapshots.get(id)?.payload?.helper?.commit !== payload.helper?.commit && !payload.generating) remount = true;
    payload.native = true; payload.theme = theme();
    publish(id, { payload, error: null });
    if (remount) { controller?.dispose(); controllers.delete(id); await ensure(id); }
    else if (controller?.port) await controller.call('sync', payload);
    return payload;
  }
  async function ensure(id) {
    if (disposed) return;
    if (controllers.has(id)) return controllers.get(id).ready;
    const controller = { id, hubId: crypto.randomUUID(), pending: new Map() };
    controllers.set(id, controller);
    publish(id, { ready: false, runtimeId: controller.hubId });
    controller.ready = (async () => {
      const [settings, payload] = await Promise.all([loadBootstrap(), api('/native-ensure', { id })]);
      if (controllers.get(id) !== controller) return;
      if (!payload.state) { publish(id, { payload: null, error: null, loaded: true }); return; }
      payload.native = true; payload.theme = theme(); publish(id, { payload, error: null });
      const frame = document.createElement('iframe'); controller.frame = frame;
      frame.className = 'tavern-runtime-overlay';
      frame.title = '角色脚本运行环境'; frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.allow = 'clipboard-write';
      frame.sandbox = 'allow-scripts allow-same-origin allow-modals allow-downloads';
      frame.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:50;background:transparent;color-scheme:inherit;clip-path:inset(100%)';
      document.body.append(frame); layoutOverlays();
      const channel = new MessageChannel(); controller.port = channel.port1;
      let resolveReady, rejectReady;
      const loaded = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const timeout = setTimeout(() => rejectReady(new Error('角色前端加载超时')), 25000);
      controller.cancelLoad = () => { clearTimeout(timeout); resolveReady(); };
      controller.call = (method, args) => new Promise((resolve, reject) => {
        const key = crypto.randomUUID();
        const timeoutMs = ['button', 'settings'].includes(method) ? 0 : method === 'messageReceived' ? 660000 : 20000;
        const timer = timeoutMs ? setTimeout(() => { controller.pending.delete(key); reject(new Error(`前端 ${method} 响应超时`)); }, timeoutMs) : undefined;
        controller.pending.set(key, { resolve, reject, timer });
        controller.port.postMessage({ type: 'call', id: key, method, args });
      });
      controller.port.onmessage = async event => {
        const data = event.data;
        if (data.type === 'ready') { clearTimeout(timeout); controller.buttons = data.buttons ?? []; controller.errors = data.errors ?? []; resolveReady(); }
        else if (data.type === 'ui') { controller.rectangles = data.rectangles; layoutOverlays(); }
        else if (data.type === 'buttons') { controller.buttons = data.buttons; publish(id, { payload: snapshots.get(id)?.payload }); }
        else if (data.type === 'regex') { publish(id, { payload: { ...snapshots.get(id)?.payload, regex: data.regex } }); }
        else if (data.type === 'result') {
          const request = controller.pending.get(data.id); if (!request) return;
          controller.pending.delete(data.id); clearTimeout(request.timer); data.error ? request.reject(new Error(data.error)) : request.resolve(data.value);
        } else if (data.type === 'rpc') {
          try {
            const result = await api('/runtime', { sessionId: id, method: data.method, args: data.args });
            if (result.state) publish(id, { payload: { ...snapshots.get(id).payload, state: result.state } });
            controller.port.postMessage({ type: 'rpc-result', id: data.id, value: result.value ?? result });
          } catch (error) { controller.port.postMessage({ type: 'rpc-result', id: data.id, error: error.message }); }
        } else if (data.type === 'draft') input(id)?.setDraft(data.text);
        else if (data.type === 'send') { const target = input(id); if (target) { target.setDraft(data.text || '继续。'); target.submit(); } }
        else if (data.type === 'notice') publish(id, { notice: data.message ? { ...data, id: crypto.randomUUID() } : null });
        else if (data.type === 'error') report(id, data.message);
      };
      frame.onload = () => frame.contentWindow.postMessage({ type: 'tavern-init', hubId: controller.hubId, payload }, settings.runtimeOrigin, [channel.port2]);
      frame.src = settings.runtimeOrigin + '/host';
      await loaded;
      if (controller.disposed) return;
      const onEvent = async event => {
        const data = JSON.parse(event.data);
        try {
          if (data.type === 'runtime') {
            try { const value = await controller.call(data.method, data.args); await api('/native-reply', { sessionId: id, id: data.id, value }); }
            catch (error) { await api('/native-reply', { sessionId: id, id: data.id, error: error.message }); }
          } else if (data.type === 'assets') { controller.assetsStale = true; if (!snapshots.get(id)?.payload?.generating) { await controller.call('flush', {}); await refresh(id, true); }
          } else if (data.type === 'updated') await refresh(id, data.remount);
          else if (data.type === 'finished') { await refresh(id); await controller.call('finished', { cancelled: !!data.cancelled }); if (controller.assetsStale) { await controller.call('flush', {}); await refresh(id, true); } }
          else if (data.type === 'error') report(id, data.message);
        } catch (error) { report(id, error.message); }
      };
      const connectEvents = () => {
        const url = new URL('/api/tavern/native-events', location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('id', id);
        controller.events = new WebSocket(url);
        controller.events.onmessage = onEvent;
        controller.events.onclose = event => { if (!controller.disposed && event.code !== 1008) controller.reconnect = setTimeout(connectEvents, 1000); };
      };
      connectEvents();
      publish(id, { payload: snapshots.get(id).payload, error: controller.errors?.join('\n') || null, loaded: true, ready: true });
      return controller;
    })().catch(error => { if (!controller.disposed) report(id, error.message); controller.dispose(); if (controllers.get(id) === controller) controllers.delete(id); });
    controller.dispose = () => {
      controller.disposed = true; clearTimeout(controller.reconnect);
      controller.cancelLoad?.();
      controller.events?.close(); controller.port?.close(); controller.frame?.remove();
      for (const request of controller.pending.values()) { clearTimeout(request.timer); request.reject(new Error('角色前端已关闭')); }
      controller.pending.clear();
      if (controllers.get(id) === controller) publish(id, { ready: false, runtimeId: undefined });
    };
    return controller.ready;
  }
  const updateTheme = () => { const value = theme(); for (const controller of controllers.values()) controller.call?.('theme', value).catch(() => {}); };
  const themeObserver = new MutationObserver(updateTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] });
  window.addEventListener('resize', updateTheme);
  async function newSession(mode, workspaceId) {
    const list = ctx.sessions.list.getSnapshot(), current = list.byId[list.current];
    const target = workspaceId ?? ctx.workspaces.list.getSnapshot().items.find(workspace => workspace.sessionIds.includes(list.current))?.workspaceId;
    const id = await ctx.sessions.create(target ? { workspaceId: target } : current?.cwd ? { cwd: current.cwd } : {});
    ctx.uiWorkspace.openSession(id);
    if (mode) {
      const refusal = await ctx.slots.entriesOfSlot('conversation.hero.agentPreset')[0].inject().select(mode);
      if (refusal) throw new Error(refusal);
    }
    return id;
  }
  return {
    ensure, refresh, bootstrap: loadBootstrap,
    newSession,
    mountView(id, element) {
      if (!element && view?.id !== id) return;
      view = element ? { id, element } : undefined;
      viewportObserver.disconnect();
      if (element) viewportObserver.observe(element);
      layoutOverlays();
    },
    clearNotice(id, noticeId) { if (snapshots.get(id)?.notice?.id === noticeId) publish(id, { notice: null }); },
    async changeMode(mode) {
      const list = ctx.sessions.list.getSnapshot(), current = list.byId[list.current];
      if (current?.projectionValues?.agentPreset === mode) return;
      if (current && !current.blank) { await newSession(mode); return; }
      return ctx.slots.entriesOfSlot('conversation.hero.agentPreset')[0].inject().select(mode);
    },
    async selectCard(id, selection, configuration) {
      const previous = snapshots.get(id)?.payload?.state;
      const current = ctx.sessions.list.getSnapshot().byId[id];
      if (previous && previous.cardId !== selection.cardId && (!current?.blank || previous.turn)) id = await newSession('tavern');
      await api('/native-selection', { id, selection, configuration });
      await refresh(id, true);
      return id;
    },
    get: id => snapshots.get(id) ?? empty,
    setRunning(id, generating) { const payload = snapshots.get(id)?.payload; if (payload && payload.generating !== generating) publish(id, { payload: { ...payload, generating } }); },
    async messageAction(id, request) {
      const target = input(id);
      if ((request.action === 'reroll' || request.action === 'rewrite') && !target) throw new Error('当前对话输入框未就绪');
      const result = await api('/message', { sessionId: id, revision: snapshots.get(id)?.payload?.state.revision, ...request });
      await refresh(id, true);
      if (result.text !== undefined) { target.setDraft(result.text); target.submit(); }
      return result;
    },
    controller: id => controllers.get(id),
    async script(id, name) {
      const controller = await ensure(id); if (!controller) return;
      await controller.call(name ? 'button' : 'settings', name ? { name } : { open: true });
    },
    subscribe(id, callback) { if (!listeners.has(id)) listeners.set(id, new Set()); listeners.get(id).add(callback); return () => listeners.get(id)?.delete(callback); },
    retain(ids) { for (const [id, controller] of controllers) if (!ids.has(id)) { controller.dispose(); controllers.delete(id); } },
    dispose() { disposed = true; themeObserver.disconnect(); viewportObserver.disconnect(); cancelAnimationFrame(overlayFrame); window.removeEventListener('resize', updateTheme); for (const controller of controllers.values()) controller.dispose(); controllers.clear(); },
    report,
  };
}
