import { sessionAssets as loadSessionAssets } from './session-assets.js';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { Store, readJson, atomicJson, safeId } from './storage.js';
import { importPath, importBytes, importLegacyPrompts, identifyJson } from './imports.js';
import { defaultConfig, completeConfig, validateConfig, validateProtocol, SCENE } from './contracts.js';
import { makeModelCaller } from './model.js';
import { describeTables } from './tables.js';
import { allRegex, assembleWritingPrompt, prepareWorldbook } from './prompts.js';
import { installNativeService } from './native-service.js';
import { installNativeEvents } from './native-events.js';
import { startRuntimeServer } from './runtime-server.js';
import { SharedAssets } from './shared-assets.js';
import { messageAction, deleteMessages, messageHistory } from './message-actions.js';
import { openHelper } from './helper-update.js';
import { ensureTableHistory, recordTableChanges } from './table-history.js';
import { configurationHistory, saveConfiguration } from './configuration-history.js';
import { installPreset } from './install-preset.js';

export const name = 'tavern-mode';
export const inject = ['webServer', 'connection', 'llm', 'agentDefaultModel', 'agents', 'sessions', 'sessionProjections', 'sessionController'];
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mime = extension => ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.avif': 'image/avif' })[extension] ?? 'application/octet-stream';
const roles = new Set(['system', 'user', 'assistant']);

async function readBody(req, limit = 180_000_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('请求内容过大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function checkRevision(state, revision) { if (revision && state.revision !== revision) throw new Error('会话已更新，请刷新后重试'); }
function record(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`); return value; }

export async function apply(ctx, config = {}) {
  await installPreset();
  const store = new Store(resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), config.dataDir ?? 'tavern'));
  await store.init();
  await mkdir(join(store.root, 'runtime'), { recursive: true, mode: 0o700 });
  const sharedAssets = new SharedAssets(store);
  await sharedAssets.init();
  const callModel = makeModelCaller(ctx.llm);
  const jobs = new Map();
  const helper = await openHelper(root, store.root);
  const runtimeOrigin = await startRuntimeServer(ctx, root, helper, join(store.root, 'runtime/modules'));

  async function globalConfig() {
    const settings = await store.settings();
    return { ...settings, config: completeConfig(settings.config) };
  }
  const runtimeStorage = state => sharedAssets.snapshot(state);
  const sessionAssets = state => loadSessionAssets(store, state);
  async function browserPayload(state) {
    const assets = await sessionAssets(state);
    const presets = await Promise.all((await store.library()).filter(item => item.kind === 'preset').map(async item => ({ ...item, data: (await store.item(item.id)).data })));
    return { state, generating: jobs.has(state.id), helper: helper.status(), cardId: assets.cardItem.id, card: assets.card, preset: assets.preset, presetName: assets.presetItem?.name ?? 'SillyTavern Default', presets, worldbooks: assets.extraBooks, globalRegex: assets.regex, regex: allRegex(assets.card, assets.preset, assets.regex, state.regexOrder), runtimeStorage: await runtimeStorage(state) };
  }
  const checkIdle = id => { if (jobs.has(id) && !jobs.get(id).preparing) throw new Error('该会话正在生成，请完成或停止后再修改'); };
  const nativeApi = installNativeService(ctx, { store, sessionAssets, browserPayload, jobs });
  ctx.effect(() => installNativeEvents(ctx, ctx.tavernMode.connect));
  ctx.effect(() => helper.start(() => ctx.tavernMode.reloadHelpers()));
  async function editSession(id, revision, work) {
    checkIdle(id);
    return store.exclusive(id, async () => {
      checkIdle(id);
      const state = await store.session(id); checkRevision(state, revision);
      await work(state);
      if (state.nativeSession) state.nativeAnchorSeq = ctx.sessions.get(id).snapshotEvents().at(-1)?.seq ?? -1;
      return store.saveSession(state);
    });
  }
  async function api(req, res) {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection) { json(res, { error: rejection === 401 ? '请先登录 dsh' : '请求来源不受信任' }, rejection); return; }
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.slice('/api/tavern'.length) || '/bootstrap';
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (await nativeApi(req, res, path, body, url, json)) return;
    if (req.method === 'GET' && path === '/configurations') { json(res, await configurationHistory(store)); return; }
    if (path === '/configurations' && req.method === 'POST') { json(res, await saveConfiguration(store, body)); return; }
    if (req.method === 'GET' && path === '/messages') {
      const id = url.searchParams.get('id'), state = await store.session(id);
      json(res, messageHistory(state, ctx.sessions.get(id).snapshotEvents())); return;
    }
    if (req.method === 'GET' && path === '/model-info') {
      const session = ctx.sessions.get(url.searchParams.get('sessionId'));
      const selection = session && ctx.sessionProjections.stateOf(session, 'modelSelection');
      const route = selection?.pending ?? selection?.lastUsed ?? ctx.agentDefaultModel.currentSelection();
      const provider = url.searchParams.get('provider') || route.provider, model = url.searchParams.get('model') || route.model;
      json(res, await ctx.llm.resolveModelInfo(provider, model)); return;
    }
    if (req.method === 'GET' && path === '/bootstrap') {
      const providers = ctx.llm.listProviders();
      const models = await Promise.all(providers.map(async provider => {
        const name = provider.provider ?? provider.id ?? provider.name;
        try { return { ...provider, provider: name, models: await ctx.llm.listModels(name) }; }
        catch (error) { return { ...provider, provider: name, models: [], error: error.message }; }
      }));
      json(res, { version: '0.4.2-rc.2', dshVersion: '0.1.5-rc.1', runtimeOrigin, helper: helper.status(), library: await store.library(), sessions: await store.sessions(), ...(await globalConfig()), providers: models }); return;
    }
    if (req.method === 'GET' && path === '/session') { json(res, await browserPayload(await store.session(url.searchParams.get('id'), url.searchParams.get('revision')))); return; }
    if (req.method === 'GET' && path === '/item') { json(res, await store.item(url.searchParams.get('id'))); return; }
    if (req.method === 'GET' && path === '/asset') { const id = url.searchParams.get('id'); const data = await store.asset(id); res.writeHead(200, { 'content-type': mime(extname(id)), 'cache-control': 'private, max-age=86400' }); res.end(data); return; }
    if (req.method === 'GET' && path === '/export') {
      const state = await store.session(url.searchParams.get('id'));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="tavern-${safeId(state.id)}.json"`, 'cache-control': 'no-store' });
      res.end(JSON.stringify({ format: 'dsh-tavern-session', version: 1, state, assets: await sessionAssets(state) }, null, 2)); return;
    }
    if (req.method !== 'POST') { json(res, { error: '接口不存在' }, 404); return; }
    if (path === '/import') {
      const items = body.path ? await importPath(store, body.path) : await importBytes(store, String(body.name), Buffer.from(String(body.base64), 'base64'));
      if (await sharedAssets.importBundles(items, true)) ctx.tavernMode.assetsChanged();
      json(res, { items }); return;
    }
    if (path === '/import-legacy') { json(res, { items: await importLegacyPrompts(store, String(body.path)) }); return; }
    if (path === '/item') {
      const item = await store.item(body.id);
      if (identifyJson(body.data) !== item.kind) throw new Error('编辑后的资源类型发生变化');
      if (item.kind === 'tables') describeTables(body.data);
      const saved = await store.putItem({ ...item, data: body.data });
      if (item.kind === 'preset') {
        if (body.sessionId) {
          if (await ctx.tavernMode.ensure(body.sessionId)) await editSession(body.sessionId, undefined, state => { if (state.presetId === item.id) state.presetOverride = body.data; });
          else {
            const draft = await ctx.tavernMode.draftSettings(body.sessionId);
            if ((draft.selection?.presetId || item.id) === item.id) { draft.presetOverride = body.data; await ctx.tavernMode.saveDraftSettings(body.sessionId, draft); }
          }
        }
        const settings = await store.settings();
        if (settings.selection?.presetId === item.id) { settings.presetOverride = body.data; await store.saveSettings(settings); }
      }
      json(res, saved); return;
    }
    if (path === '/config') {
      if (body.sessionId && !await ctx.tavernMode.ensure(body.sessionId)) {
        const settings = await ctx.tavernMode.draftSettings(body.sessionId);
        const config = completeConfig(settings.config, record(body.config, '模型配置')); validateConfig(config);
        await ctx.tavernMode.saveDraftSettings(body.sessionId, { ...settings, config });
        json(res, { ok: true }); return;
      }
      if (body.sessionId) { json(res, { state: await editSession(body.sessionId, body.revision, state => { const config = completeConfig(state.config, record(body.config, '模型配置')); validateConfig(config); state.config = config; }) }); return; }
      const settings = await store.settings(); const config = completeConfig(settings.config, record(body.config, '模型配置')); validateConfig(config); await store.saveSettings({ ...settings, config });
      json(res, { ok: true }); return;
    }
    if (path === '/session') {
      const state = await editSession(body.id, body.revision, async state => {
        const fields = record(body.fields, '会话设置');
        for (const key of Object.keys(fields)) if (!['title', 'userName', 'persona', 'characters', 'renderMode', 'presetId', 'toolPresetId', 'legacyId', 'bubbleId', 'tables', 'worldbookIds', 'regexIds', 'scene'].includes(key)) throw new Error(`不能修改字段 ${key}`);
        if (fields.characters) {
          if (!Array.isArray(fields.characters) || fields.characters.some(c => !c.name?.trim() || !safeId(c.id))) throw new Error('角色目录无效');
          const old = state.characters.map(c => c.id);
          if (old.some(id => !fields.characters.some(c => c.id === id) && state.memories[id]?.length)) throw new Error('已有记忆的角色请设为不参与，保留其独立记忆');
        }
        if (fields.tables || fields.scene) { if (fields.tables) describeTables(fields.tables); await ensureTableHistory(store, state); recordTableChanges(state, fields.tables ?? state.tables, { ...(fields.scene ? { scene: fields.scene } : {}) }); }
        if (fields.scene) validateProtocol(fields.scene, SCENE);
        if (fields.renderMode && !['card', 'bubble', 'text'].includes(fields.renderMode)) throw new Error('渲染模式无效');
        Object.assign(state, fields);
        if (fields.characters?.length) state.needsRoster = false;
        await sessionAssets(state);
      });
      json(res, { state }); return;
    }
    if (path === '/helper') {
      if (body.autoUpdate !== undefined) await helper.configure(body.autoUpdate);
      if (body.check) { const previous = helper.status().commit; await helper.check(); if (previous !== helper.status().commit) ctx.tavernMode.reloadHelpers(); }
      json(res, helper.status()); return;
    }
    if (path === '/message') {
      const id = body.sessionId;
      await ctx.tavernMode.ensure(id);
      let text;
      const state = await editSession(id, body.revision, async state => {
        if (jobs.has(id) || ctx.agents.get(id)?.status === 'running') throw new Error('请先停止当前生成');
        const result = await messageAction(store, state, ctx.sessions.get(id).snapshotEvents(), body);
        text = result.text;
        if (result.state !== state) {
          for (const key of Object.keys(state)) delete state[key];
          Object.assign(state, result.state);
        }
      });
      json(res, { state, text }); return;
    }
    if (path === '/runtime') {
      const id = body.sessionId;
      const current = await store.session(id);
      if (body.method === 'helperUpdate') {
        const previous = helper.status().commit; await helper.check();
        json(res, { value: helper.status() });
        if (previous !== helper.status().commit) setTimeout(() => ctx.tavernMode.reloadHelpers(), 1000).unref();
        return;
      }
      if (body.method === 'asset') { json(res, { value: (await store.asset(body.args.id)).toString('base64') }); return; }
      if (body.method === 'putAsset') {
        const value = await sharedAssets.externalize({ __dsh_type: 'blob', mime: body.args.mime, bytes: body.args.bytes });
        json(res, { value: value.assetId }); return;
      }
      if (body.method === 'storage') {
        record(body.args, '前端存储');
        const changed = await sharedAssets.save(current, body.args);
        json(res, { ok: true });
        if (changed) ctx.tavernMode.assetsChanged(id);
        return;
      }
      if (body.method === 'preset') {
        const item = await store.item(body.args.id);
        if (item.kind !== 'preset' || identifyJson(body.args.data) !== 'preset') throw new Error('预设数据无效');
        if (body.args.inUse) { const state = await editSession(id, undefined, state => { state.presetOverride = body.args.data; }); json(res, { state, value: true }); return; }
        await store.putItem({ ...item, data: body.args.data }); json(res, { ok: true }); return;
      }
      if (body.method === 'createPreset') {
        const name = String(body.args.name ?? '').trim();
        if (!name || name === 'in_use' || identifyJson(body.args.data) !== 'preset') throw new Error('新预设无效');
        if ((await store.library()).some(item => item.kind === 'preset' && item.name === name)) throw new Error('同名预设已经存在，请刷新后重试');
        const item = await store.putItem({ kind: 'preset', name, data: body.args.data, source: 'tavern-helper' });
        json(res, { value: item }); return;
      }
      if (body.method === 'loadPreset') {
        const item = await store.item(body.args.id); if (item.kind !== 'preset') throw new Error('请选择预设');
        const state = await editSession(id, undefined, state => { state.presetId = item.id; delete state.presetOverride; });
        json(res, { state, value: true }); return;
      }
      if (body.method === 'worldbook') {
        checkIdle(id);
        const { name, primary, entries } = body.args;
        if (!Array.isArray(entries) || entries.some(entry => !Number.isSafeInteger(entry.uid) || typeof entry.content !== 'string') || new Set(entries.map(entry => entry.uid)).size !== entries.length) throw new Error('世界书条目无效或编号重复');
        const assets = await sessionAssets(current);
        const item = primary ? assets.cardItem : assets.extraBooks.find(book => book.name === name || book.id === name);
        if (!item) throw new Error('当前会话未加载该世界书');
        const data = structuredClone(item.data);
        if (primary) (data.data ?? data).character_book.entries = entries;
        else data.entries = entries;
        await store.putItem({ ...item, data });
        const state = await editSession(id, undefined, state => { delete (state.worldbookOverrides ?? {})[item.id]; });
        json(res, { state, value: true }); return;
      }
      if (body.method === 'characterExtension') {
        checkIdle(id);
        if (body.args.key !== 'regex_scripts' || !Array.isArray(body.args.value) || body.args.value.some(regex => typeof regex.findRegex !== 'string')) throw new Error('角色正则数据无效');
        const item = await store.item(current.cardId), data = structuredClone(item.data);
        ((data.data ?? data).extensions ??= {}).regex_scripts = body.args.value;
        await store.putItem({ ...item, data }); json(res, { value: true }); return;
      }
      if (body.method === 'generate') {
        const assets = await sessionAssets(current);
        const options = body.args;
        const messages = options.raw ? options.ordered_prompts ?? options.messages : (await assembleWritingPrompt({ state: { ...current, messages: [...current.messages, { role: 'user', content: options.user_input ?? '' }] }, ...assets, worldbook: await prepareWorldbook(current, assets.card, assets.extraBooks) })).messages;
        if (!Array.isArray(messages) || messages.some(m => !roles.has(String(m.role).toLowerCase()) || typeof m.content !== 'string')) throw new Error('辅助生成提示词无效');
        const writer = current.config.agents.write;
        const selection = ctx.sessionProjections.stateOf(ctx.sessions.get(id), 'modelSelection');
        const route = selection?.pending ?? selection?.lastUsed ?? ctx.agentDefaultModel.currentSelection();
        const generate = jobs.get(id)?.callModel ?? callModel;
        const result = await generate({ stage: 'write', label: '前端辅助生成', agent: { ...writer, provider: writer.provider || route.provider, model: writer.model || route.model, maxTokens: options.max_tokens ?? writer.maxTokens, presetReasoningEffort: assets.preset?.reasoning_effort }, messages: messages.map(m => ({ role: m.role.toLowerCase(), content: m.content })), retries: 0 });
        json(res, { value: result }); return;
      }
      let runtimeValue = true;
      const state = await editSession(id, undefined, async state => {
        if (body.method === 'userName') {
          checkIdle(id);
          if (typeof body.args.userName !== 'string' || !body.args.userName.trim()) throw new Error('请输入你的名字');
          state.userName = body.args.userName.trim();
        } else if (body.method === 'variables') {
          for (const key of ['variables', 'globalVariables', 'characterVariables', 'messageVariables', 'scriptVariables', 'presetVariables', 'extensionSettings']) if (body.args[key] !== undefined) state[key] = record(body.args[key], key);
        } else if (body.method === 'createChat') {
          const { messages, before } = body.args;
          if (!Array.isArray(messages) || messages.some(message => !roles.has(message.role) || typeof message.message !== 'string' || typeof message.name !== 'string') || !Number.isSafeInteger(before) || before < 0 || before > state.messages.length) throw new Error('要插入的消息无效');
          const variables = state.messages.map((message, index) => state.messageVariables?.[index] ?? [{}]);
          const created = messages.map(message => ({ id: randomUUID(), role: message.role, name: message.name, content: message.message, createdAt: new Date().toISOString(), scriptCreated: true, is_hidden: !!message.is_hidden, extra: { ...(message.role === 'system' ? { type: 'narrator' } : {}), ...message.extra } }));
          state.messages.splice(before, 0, ...created);
          variables.splice(before, 0, ...messages.map(message => [message.data ?? {}]));
          state.messageVariables = Object.fromEntries(variables.map((value, index) => [index, value]));
          runtimeValue = { created };
        } else if (body.method === 'worldbookSettings') {
          state.worldbookSettings = record(body.args, '世界书设置');
        } else if (body.method === 'editChat') {
          if (!Array.isArray(body.args.chat) || body.args.chat.length !== state.messages.length || body.args.chat.some(m => typeof m.mes !== 'string')) throw new Error('消息列表无效');
          state.helperChat = body.args.chat.map((message, index) => ({ ...message, tavernMessageId: state.messages[index].id }));
          state.messageVariables = Object.fromEntries(body.args.chat.map((message, index) => [index, message.variables ?? [{}]]));
        } else if (body.method === 'deleteChat') {
          await ensureTableHistory(store, state);
          deleteMessages(state, body.args.ids);
        } else throw new Error(`未实现前端接口 ${body.method}`);
      });
      json(res, { state, value: runtimeValue }); return;
    }
    json(res, { error: '接口不存在' }, 404);
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/tavern', handler: async (req, res) => {
    try { await api(req, res); }
    catch (error) { if (!res.headersSent) json(res, { error: error.message }, 400); else res.end(); }
  } }), 'tavern: API');
}
