import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { readJson, atomicJson, safeId } from './storage.js';
import { defaultTables } from './defaults.js';
import { defaultConfig, validateConfig } from './contracts.js';
import { describeTables } from './tables.js';
import { runTurn, buildRoster } from './pipeline.js';
import { ensureTableHistory, recordTableChanges } from './table-history.js';
import { configurationFields } from './configuration-history.js';

const textOf = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');

export function installNativeService(ctx, { store, sessionAssets, browserPayload, jobs }) {
  const clients = new Map(), replies = new Map(), connections = new Map();
  const nativeSession = async id => {
    safeId(id);
    let session = ctx.sessions.get(id);
    if (!session && ctx.sessionController) {
      const resolved = await ctx.sessionController.resolveAgent(id);
      if (resolved.error) throw new Error(resolved.error.message);
      session = resolved.agent.session;
    }
    if (!session || ctx.sessionProjections.stateOf(session, 'agentPreset') !== 'tavern') throw new Error('请先选择酒馆模式');
    return session;
  };
  const broadcast = (id, value) => { for (const client of clients.get(id) ?? []) if (client.readyState === 1) client.send(JSON.stringify(value)); };
  const pendingPath = id => join(store.sessionDir(id), 'native-pending.json');
  const settingsPath = id => join(store.sessionDir(id), 'native-settings.json');
  async function draftSettings(id) {
    await nativeSession(id);
    return store.exclusive('native-settings:' + id, async () => {
      let settings = await readJson(settingsPath(id), null);
      if (!settings) {
        const defaults = await store.settings();
        settings = { selection: { ...defaults.selection, cardId: '' }, config: defaults.config ?? defaultConfig(), ...(defaults.presetOverride ? { presetOverride: defaults.presetOverride } : {}) };
        await mkdir(store.sessionDir(id), { recursive: true, mode: 0o700 });
        await atomicJson(settingsPath(id), settings);
      }
      return settings;
    });
  }

  async function commitSession(session) {
    return store.exclusive('native-commit:' + session.id, async () => {
      const pending = await readJson(pendingPath(session.id), null);
      if (!pending) return;
      const final = session.snapshotEvents().findLast(event => event.type === 'assistant/message' && event.data.turn === pending.turn && event.data.step === pending.step && !event.data.interrupted);
      if (!final || textOf(final.data.message) !== (pending.nativeText ?? pending.text)) return;
      const path = join(store.sessionDir(session.id), 'revisions', safeId(pending.revision), 'state.json');
      const data = await readJson(path);
      data.messages.at(-1).nativeMessageId = final.data.message.id;
      await atomicJson(path, { ...data, nativeAnchorSeq: final.seq, nativeMessageId: final.data.message.id });
      await store.restore(session.id, pending.revision);
      await rm(pendingPath(session.id));
      broadcast(session.id, { type: 'updated' });
    });
  }

  async function selectedTables(cardItem, tableId) {
    if (!tableId && cardItem.sourceHash) {
      const companions = (await store.library()).filter(item => item.kind === 'tables' && item.sourceHash === cardItem.sourceHash);
      if (companions.length === 1) tableId = companions[0].id;
    }
    if (!tableId) return { tableId: null, tables: defaultTables() };
    const item = await store.item(tableId);
    if (item.kind !== 'tables') throw new Error('请选择表格模板');
    describeTables(item.data);
    return { tableId, tables: structuredClone(item.data) };
  }

  async function createState(id, selection, configuration = {}) {
    if (!selection.cardId) throw new Error('请在酒馆模式的设置中选择一张角色卡');
    const item = await store.item(selection.cardId);
    if (item.kind !== 'card') throw new Error('请选择角色卡');
    const card = item.data.data ?? item.data;
    const settings = await draftSettings(id);
    const { tableId, tables } = await selectedTables(item, selection.tableId);
    const greeting = Number(selection.greetingIndex ?? 0) === 0 ? card.first_mes : card.alternate_greetings?.[Number(selection.greetingIndex) - 1];
    const state = {
      id, nativeSession: true, nativeAnchorSeq: -1,
      cardId: item.id, presetId: selection.presetId || null, toolPresetId: selection.toolPresetId || null, tableId, legacyId: selection.legacyId || null, bubbleId: selection.bubbleId || null,
      worldbookIds: selection.worldbookIds ?? [], regexIds: selection.regexIds ?? [],
      title: card.name, userName: selection.userName?.trim() || '你', persona: selection.persona ?? '',
      renderMode: selection.renderMode ?? (card.extensions?.regex_scripts?.some(r => !r.disabled) ? 'card' : 'bubble'),
      config: settings.config ?? defaultConfig(), turn: 0, messages: greeting ? [{ id: randomUUID(), role: 'assistant', name: card.name, content: greeting, createdAt: new Date().toISOString(), greeting: true }] : [],
      characters: [], memories: {}, tables, needsRoster: true,
      variables: { ...card.extensions?.tavern_helper?.variables }, globalVariables: {}, worldActivation: {}, scene: { location: '', time: '', summary: '' },
    };
    if (state.presetId) state.presetOverride = settings.selection.presetId === state.presetId && settings.presetOverride ? settings.presetOverride : (await store.item(state.presetId)).data;
    Object.assign(state, configuration);
    await sessionAssets(state);
    return store.saveSession(state);
  }

  async function ensure(id) {
    const session = await nativeSession(id);
    await commitSession(session);
    let state;
    try { state = await store.session(id); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state) {
      if (state.cardId && !state.turn && !state.tableId && isDeepStrictEqual(state.tables, defaultTables())) {
        const selected = await selectedTables(await store.item(state.cardId));
        if (selected.tableId) return store.saveSession({ ...state, ...selected });
      }
      return state;
    }
    if (session.header.parentSession) {
      let state;
      try { state = await store.session(session.header.parentSession); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (state) {
        while (state.nativeAnchorSeq >= session.inheritedEventCount && state.previousRevision) state = await store.session(state.id, state.previousRevision);
        if (state.nativeAnchorSeq >= session.inheritedEventCount) throw new Error('未找到该分支时间点的角色记忆');
        const fork = { ...state, id, parentSessionId: state.id, revision: undefined, previousRevision: null, lastRun: state.lastRun ? { ...state.lastRun, previousRevision: null } : undefined };
        return store.saveSession(fork);
      }
    }
    return null;
  }

  async function runtimeCall(id, method, args, signal) {
    signal.throwIfAborted();
    if (!clients.get(id)?.size) await new Promise((resolve, reject) => {
      const dispose = () => { clearTimeout(timer); connections.get(id)?.delete(connected); signal.removeEventListener('abort', aborted); };
      const connected = () => { dispose(); resolve(); };
      const aborted = () => { dispose(); reject(signal.reason ?? new Error('生成已停止')); };
      const timer = setTimeout(() => { dispose(); reject(new Error('角色前端尚未连接，请打开当前酒馆会话后重试')); }, 25000);
      if (!connections.has(id)) connections.set(id, new Set());
      connections.get(id).add(connected);
      signal.addEventListener('abort', aborted, { once: true });
    });
    const callId = randomUUID();
    return new Promise((resolve, reject) => {
      const dispose = () => { clearTimeout(timer); replies.delete(callId); signal.removeEventListener('abort', abort); };
      const abort = () => { dispose(); reject(signal.reason ?? new Error('生成已停止')); };
      const timer = setTimeout(() => { dispose(); reject(new Error('角色前端响应超时，请刷新当前会话后重试')); }, method === 'messageReceived' ? 660000 : 20000);
      replies.set(callId, { sessionId: id, resolve: value => { dispose(); resolve(value); }, reject: error => { dispose(); reject(error); } });
      signal.addEventListener('abort', abort, { once: true });
      const connected = clients.get(id), job = jobs.get(id);
      let client = job?.frontend;
      if (!client || client.readyState !== 1 || !connected?.has(client)) client = [...(connected ?? [])].findLast(client => client.readyState === 1);
      if (job) job.frontend = client;
      client?.send(JSON.stringify({ type: 'runtime', id: callId, method, args }));
    });
  }
  const service = {
    ensure,
    reloadHelpers() { for (const id of clients.keys()) if (!jobs.has(id)) broadcast(id, { type: 'updated', remount: true }); },
    assetsChanged(exceptId) { for (const id of clients.keys()) if (id !== exceptId) broadcast(id, { type: 'assets' }); },
    draftSettings,
    saveDraftSettings: (id, settings) => atomicJson(settingsPath(id), settings),
    async recordModelAttempt(id, record) {
      const taskId = safeId(record.taskId), dir = join(store.sessionDir(id), 'model-attempts');
      await store.exclusive(`model-attempt:${id}:${taskId}`, async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const path = join(dir, `${taskId}.json`), records = await readJson(path, []);
        await atomicJson(path, [...records, record]);
      });
    },
    async connect(id, client) {
      await nativeSession(id);
      if (client.readyState !== 1) return;
      if (!clients.has(id)) clients.set(id, new Set());
      clients.get(id).add(client);
      client.once('close', () => clients.get(id)?.delete(client));
      client.send(JSON.stringify({ type: 'connected' }));
      for (const connected of connections.get(id) ?? []) connected();
    },
    async run({ agent, messages, route, callModel, signal }) {
      const id = agent.id;
      if (!await ensure(id)) throw new Error('请先导入并选择角色卡');
      if (jobs.has(id)) throw new Error('该会话正在推进');
      jobs.set(id, { controller: { abort: reason => agent.cancel({ kind: 'user' }) }, callModel, preparing: true });
      try {
        const input = messages.map(textOf).filter(Boolean).join('\n\n');
        if (!input.trim()) throw new Error('请输入本轮内容');
        // Drain frontend edits before acquiring the session lock or reading its
        // snapshot. Their RPC handlers need the same lock to finish saving.
        const runtime = await runtimeCall(id, 'prepare', { text: input, trigger: 'normal' }, signal);
        jobs.get(id).preparing = false;
        return await store.exclusive(id, async () => {
          let state = await ensure(id);
          const savedConfig = state.config;
          state = structuredClone(state);
          await ensureTableHistory(store, state);
          for (const config of Object.values(state.config.agents)) {
            const inherits = !config.provider && !config.model;
            config.provider ||= route.provider; config.model ||= route.model;
            if (inherits && !config.reasoningEffort) config.reasoningEffort = route.reasoningEffort ?? '';
          }
          if (runtime) {
            for (const key of ['variables', 'globalVariables', 'characterVariables', 'messageVariables', 'scriptVariables', 'presetVariables', 'extensionSettings', 'worldbookSettings', 'worldbookOverrides', 'presetOverride', 'regexOrder']) if (runtime[key]) state[key] = runtime[key];
            if (runtime.chat) state.helperChat = runtime.chat.slice(0, state.messages.length).map((message, index) => ({ ...message, tavernMessageId: state.messages[index].id }));
            state.injections = runtime.injections ?? [];
          }
          const assets = await sessionAssets(state);
          if (state.needsRoster && (state.config.playMode ?? 'agent') !== 'normal') {
            state.characters = await buildRoster({ state, ...assets, text: input, callModel, signal });
            state.needsRoster = false;
          }
          const result = await runTurn({ state, ...assets, text: input, callModel, signal,
            scanWorldbook: args => runtimeCall(id, 'worldbookScan', args, signal),
            beforeWrite: async args => (await runtimeCall(id, 'promptReady', args, signal)) ?? { messages: args.messages },
            afterWrite: async args => await runtimeCall(id, 'messageReceived', args, signal),
            beforeCommit: async () => await runtimeCall(id, 'snapshot', {}, signal),
          });
          result.config = savedConfig;
          result.messages.at(-2).nativeMessageId = messages.at(-1).id;
          return result;
        });
      } catch (error) { jobs.delete(id); broadcast(id, { type: 'finished', cancelled: true }); throw error; }
    },
    async stageFinal(agent, state, turn, step, nativeText) {
      const saved = await store.saveSession(state, { publish: false });
      await atomicJson(pendingPath(agent.id), { revision: saved.revision, turn, step, text: saved.messages.at(-1).content, ...(nativeText === undefined ? {} : { nativeText }) });
    },
    async commit(agent) { await commitSession(agent.session); jobs.delete(agent.id); broadcast(agent.id, { type: 'finished' }); },
    abort(id) { jobs.delete(id); broadcast(id, { type: 'finished', cancelled: true }); },
  };
  ctx.reflect.provide('tavernMode', service);
  ctx.on('agent/session-start', ({ agent }) => { if (ctx.sessionProjections.stateOf(agent.session, 'agentPreset') === 'tavern') commitSession(agent.session).catch(error => ctx.logger.warn(error)); });

  return async function nativeApi(req, res, path, body, url, json) {
    if (path === '/model-attempts' && req.method === 'GET') {
      const id = safeId(url.searchParams.get('id')); await nativeSession(id);
      const dir = join(store.sessionDir(id), 'model-attempts');
      let files;
      try { files = await readdir(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; files = []; }
      const records = (await Promise.all(files.filter(file => file.endsWith('.json')).map(file => readJson(join(dir, file))))).flat();
      json(res, records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); return true;
    }
    if (path === '/native-reply' && req.method === 'POST') {
      const reply = replies.get(body.id);
      if (!reply || reply.sessionId !== body.sessionId) throw new Error('前端事件已结束');
      body.error ? reply.reject(new Error(body.error)) : reply.resolve(body.value); json(res, { ok: true }); return true;
    }
    if (path === '/native-state' && req.method === 'GET') {
      const id = safeId(url.searchParams.get('id')); const session = await nativeSession(id); await commitSession(session);
      let state; try { state = await store.session(id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      json(res, state ? await browserPayload(state) : { state: null, ...await draftSettings(id) }); return true;
    }
    if (path === '/native-ensure' && req.method === 'POST') {
      const state = await ensure(body.id); json(res, state ? await browserPayload(state) : { state: null, ...await draftSettings(body.id) }); return true;
    }
    if (path === '/native-selection' && req.method === 'POST') {
      let selection = body.selection;
      const configuration = body.configuration ?? {};
      if (!configuration || Array.isArray(configuration) || typeof configuration !== 'object' || Object.keys(configuration).some(key => !configurationFields.includes(key))) throw new Error('历史配置无效');
      if (configuration.config) validateConfig(configuration.config);
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error('角色卡设置无效');
      const settings = await store.settings();
      let state;
      if (body.id) {
        await nativeSession(body.id);
        if (jobs.has(body.id)) throw new Error('请等待本轮推进完成后再修改');
        let previous; try { previous = await store.session(body.id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!previous) {
          const draft = await draftSettings(body.id);
          selection = { ...draft.selection, ...selection };
          if (selection.presetId !== draft.selection.presetId) delete draft.presetOverride;
          draft.selection = selection;
          Object.assign(draft, configuration);
          await atomicJson(settingsPath(body.id), draft);
          if (!selection.cardId) { json(res, { state: null, ...draft }); return true; }
        }
        if (previous && selection.cardId === previous.cardId) {
          const copied = ['presetId', 'toolPresetId', 'legacyId', 'bubbleId', 'renderMode', 'userName', 'persona', 'worldbookIds', 'regexIds'].filter(key => selection[key] !== undefined);
          state = { ...previous, ...Object.fromEntries(copied.map(key => [key, ['presetId', 'toolPresetId', 'legacyId', 'bubbleId'].includes(key) ? selection[key] || null : selection[key]])) };
          if (selection.presetId !== undefined && selection.presetId !== previous.presetId) delete state.presetOverride;
          Object.assign(state, configuration);
          if ((selection.tableId || null) !== previous.tableId) {
            const selected = await selectedTables(await store.item(state.cardId), selection.tableId);
            await ensureTableHistory(store, state); recordTableChanges(state, selected.tables);
            Object.assign(state, selected);
          }
          await sessionAssets(state); state = await store.saveSession(state);
        } else {
          if (previous?.turn) throw new Error('更换角色卡请新建一个酒馆会话');
          state = await createState(body.id, selection, configuration);
        }
      } else {
        if (selection.cardId && (await store.item(selection.cardId)).kind !== 'card') throw new Error('请选择角色卡');
      }
      if (!body.id) {
        if (selection.presetId !== settings.selection?.presetId) delete settings.presetOverride;
        await store.saveSettings({ ...settings, ...configuration, selection });
      }
      if (body.id) broadcast(body.id, { type: 'updated', remount: true });
      json(res, { state, selection }); return true;
    }
    return false;
  };
}
