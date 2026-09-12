import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRun, mergeTokenUsage } from '../src/native-run.js';
import { defaultTables } from '../src/defaults.js';
import { applyTableOperations, describeTables } from '../src/tables.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage.js';
import { installNativeService } from '../src/native-service.js';
import { diffStorage, mergeStorage } from '../src/runtime-snapshot.js';
import { EventEmitter } from 'node:events';
import { defaultConfig, COMBINATION, PLAN, TABLE_UPDATE } from '../src/contracts.js';
import { activateWorldbookWithEvents } from '../src/worldbook.js';
import { makeModelCaller } from '../src/model.js';

test('Native orchestration waits for DSH tool dispatch and exposes each stage in dependency order', async () => {
  const calls = [];
  const run = new NativeRun({
    callModel: async options => { calls.push(options.label); return options.label; },
    work: async call => {
      const recalls = await Promise.all(['甲', '乙'].map(label => call({ stage: 'recall', label, agent: { model: 'recall' } })));
      const plan = await call({ stage: 'advance', label: recalls.join('+'), agent: { model: 'planner' } });
      return call({ stage: 'write', label: plan + '正文', agent: { model: 'writer' } });
    },
  });
  const recall = await run.next(); assert.equal(recall.tasks.length, 2); assert.equal(calls.length, 0);
  await Promise.all(recall.tasks.map(task => run.execute(task.id, task.stage, new AbortController().signal)));
  const plan = await run.next(); assert.equal(plan.tasks[0].stage, 'advance');
  await run.execute(plan.tasks[0].id, 'advance', new AbortController().signal);
  const writing = await run.next(); assert.equal(writing.write.options.agent.model, 'writer');
  await run.execute(writing.write.id, 'write', new AbortController().signal);
  assert.equal((await run.next()).value, '甲+乙正文');
  assert.deepEqual(calls, ['甲', '乙', '甲+乙', '甲+乙正文']);
});

test('Native run sums provider usage from internal model calls so DSH can show tokens and cache hits', async () => {
  const run = new NativeRun({
    callModel: async options => {
      options.onUsage?.({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 8, cacheWriteTokens: 0, totalTokens: 20 });
      return 'ok';
    },
    work: async call => {
      await call({ stage: 'recall', label: '召回', agent: { model: 'a' } });
      return call({ stage: 'write', label: '写作', agent: { model: 'b' } });
    },
  });
  const recall = await run.next();
  assert.deepEqual(run.takeUsage(), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  await run.execute(recall.tasks[0].id, 'recall', new AbortController().signal);
  assert.deepEqual(run.takeUsage(), { inputTokens: 10, outputTokens: 2, cacheReadTokens: 8, cacheWriteTokens: 0, totalTokens: 20 });
  const writing = await run.next();
  await run.execute(writing.write.id, 'write', new AbortController().signal);
  const usage = run.takeUsage();
  assert.equal(usage.inputTokens, 10);
  assert.equal(usage.cacheReadTokens, 8);
  assert.equal(mergeTokenUsage({ inputTokens: 1, outputTokens: 1 }, { inputTokens: 2, outputTokens: 3, cacheReadTokens: 4 }).cacheReadTokens, 4);
});

test('Native cancellation releases waiting stages without running queued models', async () => {
  let calls = 0;
  const controller = new AbortController();
  const run = new NativeRun({ signal: controller.signal, callModel: async () => { calls++; }, work: call => call({ stage: 'recall' }) });
  await run.next(); controller.abort(new Error('用户停止'));
  await assert.rejects(run.next(), /用户停止/); await run.completion; assert.equal(calls, 0);
});

test('Failed native attempts retain the rejected response and retry count independently of story commits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-attempts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root); await store.init();
  const session = { id: 'attempts', snapshotEvents: () => [] };
  const ctx = { sessions: new Map([[session.id, session]]), sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide: (_name, value) => { ctx.tavernMode = value; } }, on() {} };
  const api = installNativeService(ctx, { store, jobs: new Map(), browserPayload: async state => ({ state }), sessionAssets: async () => ({}) });
  let calls = 0;
  const run = new NativeRun({
    callModel: makeModelCaller({ async *stream() {
      calls++;
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'tavern_result', arguments: JSON.stringify({ content: '第' + calls + '次错误返回' }) } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } }),
    onAttempt: record => ctx.tavernMode.recordModelAttempt(session.id, record),
    work: call => call({ stage: 'advance', label: '索引', agent: { provider: 'fixture', model: 'fixture' }, messages: [], retries: 3, schema: { type: 'object', properties: { content: { type: 'string', minLength: 100 } }, required: ['content'] } }),
  });
  const { tasks } = await run.next();
  await assert.rejects(run.execute(tasks[0].id, 'advance', new AbortController().signal), /fewer than 100/);
  await run.completion;
  assert.equal(calls, 4);
  let records;
  await api({ method: 'GET' }, {}, '/model-attempts', {}, new URL('http://localhost?id=' + session.id), (_res, data) => { records = data; });
  assert.equal(records.length, 4);
  const ordered = records.toSorted((a, b) => a.attempt - b.attempt);
  assert.deepEqual(ordered.map(r => r.status), ['retrying', 'retrying', 'retrying', 'failed']);
  assert.ok(ordered.every(r => r.taskId === tasks[0].id && r.label === '索引' && r.provider === 'fixture'));
  assert.equal(JSON.parse(ordered[3].response.toolCalls[0].arguments).content, '第4次错误返回');
  await assert.rejects(store.session(session.id), { code: 'ENOENT' });
});

test('A card alone has usable scene, character and thread tables with enforced constraints', () => {
  const tables = defaultTables(); assert.equal(describeTables(tables).length, 3);
  const updated = applyTableOperations(tables, [
    { table: 'scene', op: 'insert', rowId: null, values: { row_id: 1, location: '排练室', time: '夜晚', summary: '开始合奏' } },
    { table: 'characters', op: 'insert', rowId: null, values: { row_id: 1, name: '林岚', location: '排练室', state: '准备就绪', intention: '起拍' } },
    { table: 'threads', op: 'insert', rowId: null, values: { row_id: 1, topic: '合奏', progress: '已经开始', status: '进行中' } },
  ]);
  assert.equal(updated.sheet_scene.content[1][1], '排练室');
  assert.throws(() => applyTableOperations(updated, [{ table: 'threads', op: 'update', rowId: 1, values: { status: '未知状态' } }]), /CHECK/);
});

test('Entering Tavern leaves the card unselected and choosing a bundled card uses its accompanying tables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-setup-'));
  try {
    const store = new Store(root); await store.init();
    await store.putItem({ id: 'remembered-card', kind: 'card', name: '旧会话角色', sourceHash: 'old', data: { name: '旧会话角色', first_mes: '旧开场' } });
    await store.putItem({ id: 'bundle-card', kind: 'card', name: '图书管理员', sourceHash: 'bundle', data: { name: '图书管理员', first_mes: '图书馆开门了。' } });
    await store.putItem({ id: 'bundle-tables', kind: 'tables', name: '图书馆表格', sourceHash: 'bundle', data: defaultTables() });
    await store.saveSettings({ selection: { cardId: 'remembered-card' } });
    const session = { id: 'setup', header: {}, snapshotEvents: () => [] };
    const ctx = { sessions: new Map([[session.id, session]]), sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide: (_name, value) => { ctx.tavernMode = value; } }, on: () => {}, logger: { warn() {} } };
    const api = installNativeService(ctx, { store, jobs: new Map(), browserPayload: async state => ({ state }), sessionAssets: async () => ({}) });
    let result;
    const reply = (_response, value) => { result = value; };
    await api({ method: 'POST' }, {}, '/native-ensure', { id: session.id }, new URL('http://localhost'), reply);
    assert.equal(result.state, null);
    await assert.rejects(store.session(session.id), { code: 'ENOENT' });
    await api({ method: 'POST' }, {}, '/native-selection', { id: session.id, selection: { cardId: 'bundle-card' } }, new URL('http://localhost'), reply);
    assert.equal(result.state.cardId, 'bundle-card');
    assert.equal(result.state.tableId, 'bundle-tables');
    assert.equal(result.state.messages[0].content, '图书馆开门了。');
    assert.equal((await ctx.tavernMode.ensure(session.id)).cardId, 'bundle-card');
    await store.saveSession({ ...result.state, tableId: null, tables: defaultTables() });
    assert.equal((await ctx.tavernMode.ensure(session.id)).tableId, 'bundle-tables');
    const edited = applyTableOperations(defaultTables(), [{ table: 'scene', op: 'insert', rowId: null, values: { row_id: 1, location: '用户编辑的地点', time: '下午', summary: '手动记录' } }]);
    await store.saveSession({ ...result.state, tableId: null, tables: edited });
    assert.deepEqual((await ctx.tavernMode.ensure(session.id)).tables, edited);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Choosing a card inside one conversation leaves the global default for new conversations untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-scope-'));
  try {
    const store = new Store(root); await store.init();
    await store.putItem({ id: 'default-card', kind: 'card', name: '默认角色', data: { name: '默认角色', first_mes: '默认开场' } });
    await store.putItem({ id: 'other-card', kind: 'card', name: '别的角色', data: { name: '别的角色', first_mes: '别的开场' } });
    await store.putItem({ id: 'session-preset', kind: 'preset', name: '本对话预设', data: {} });
    await store.saveSettings({ selection: { cardId: 'default-card', presetId: 'global-preset' } });
    const session = { id: 'scope', header: {}, snapshotEvents: () => [] };
    const ctx = { sessions: new Map([[session.id, session]]), sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide: (_name, value) => { ctx.tavernMode = value; } }, on: () => {}, logger: { warn() {} } };
    const api = installNativeService(ctx, { store, jobs: new Map(), browserPayload: async state => ({ state }), sessionAssets: async () => ({}) });
    let result;
    const reply = (_response, value) => { result = value; };
    await api({ method: 'POST' }, {}, '/native-selection', { id: session.id, selection: { cardId: 'other-card', presetId: 'session-preset', toolPresetId: 'session-preset' } }, new URL('http://localhost'), reply);
    assert.equal(result.state.cardId, 'other-card');
    assert.equal(result.state.presetId, 'session-preset');
    assert.equal(result.state.toolPresetId, 'session-preset');
    assert.deepEqual((await store.settings()).selection, { cardId: 'default-card', presetId: 'global-preset' });
    await api({ method: 'POST' }, {}, '/native-selection', { selection: { cardId: 'default-card', presetId: 'next-default' } }, new URL('http://localhost'), reply);
    assert.deepEqual((await store.settings()).selection, { cardId: 'default-card', presetId: 'next-default' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Native completion publishes all state only after its matching message, recovers after restart, and forks the selected point', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-native-'));
  try {
    const store = new Store(root); await store.init();
    const events = [], parent = { id: 'parent', header: {}, snapshotEvents: () => events };
    const sessions = new Map([['parent', parent]]);
    const ctx = { sessions, sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide: (_key, value) => { ctx.tavernMode = value; } }, on: () => {}, logger: { warn: error => { throw error; } } };
    const install = () => installNativeService(ctx, { store, sessionAssets: async () => ({}), browserPayload: async state => ({ state }), jobs: new Map() });
    install();
    const initial = await store.saveSession({ id: 'parent', nativeAnchorSeq: -1, messages: [], characters: [{ id: 'actor', name: '乐手' }], memories: { actor: [] }, tables: defaultTables(), turn: 0 });
    const next = { ...initial, turn: 1, messages: [{ id: 'story', role: 'assistant', content: '合奏开始了。' }], memories: { actor: [{ id: 'memory', facts: ['合奏开始了。'] }] } };
    const agent = { id: 'parent', session: parent };
    await ctx.tavernMode.stageFinal(agent, next, 1, 7);
    assert.equal((await ctx.tavernMode.ensure('parent')).revision, initial.revision);
    events.push({ type: 'assistant/message', seq: 20, data: { turn: 1, step: 7, interrupted: true, message: { id: 'interrupted', content: [{ type: 'text', text: '合奏开始了。' }] } } });
    await ctx.tavernMode.commit(agent);
    assert.equal((await store.session('parent')).turn, 0);
    events.push({ type: 'assistant/message', seq: 22, data: { turn: 1, step: 7, interrupted: false, message: { id: 'native-story', content: [{ type: 'text', text: '合奏开始了。' }] } } });
    install();
    let publications = 0;
    const restore = store.restore.bind(store);
    store.restore = async (...args) => { publications++; return restore(...args); };
    const results = await Promise.all([ctx.tavernMode.ensure('parent'), ctx.tavernMode.ensure('parent')]);
    assert.equal(publications, 1);
    assert.equal(results[0].revision, results[1].revision);
    assert.equal(results[0].messages[0].nativeMessageId, 'native-story');
    assert.equal(results[0].memories.actor[0].id, 'memory');
    for (const [id, count, turn] of [['before', 20, 0], ['after', 23, 1]]) {
      sessions.set(id, { id, header: { parentSession: 'parent' }, inheritedEventCount: count, snapshotEvents: () => events.filter(event => event.seq < count) });
      const fork = await ctx.tavernMode.ensure(id);
      assert.equal(fork.turn, turn); assert.equal(fork.parentSessionId, 'parent');
      fork.memories.actor.push({ id: 'fork-only' }); await store.saveSession(fork);
      assert.equal((await store.session('parent')).memories.actor.length, 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Postprocessed prose commits against the exact original stream and preserves the processed text', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-processed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root); await store.init();
  const events = [], session = { id: 'processed', header: {}, snapshotEvents: () => events };
  const ctx = { sessions: new Map([[session.id, session]]), sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide: (_key, value) => { ctx.tavernMode = value; } }, on() {} };
  installNativeService(ctx, { store, sessionAssets: async () => ({}), browserPayload: async state => ({ state }), jobs: new Map() });
  const state = await store.saveSession({ id: session.id, turn: 0, messages: [], characters: [], memories: {}, tables: {} });
  const raw = '正文<tavern_ui>{bad}</tavern_ui>', processed = '正文<tavern_ui>{"status":[],"choices":[]}</tavern_ui>';
  await ctx.tavernMode.stageFinal({ id: session.id }, { ...state, turn: 1, messages: [{ id: 'reply', role: 'assistant', content: processed }] }, 1, 2, raw);
  events.push({ type: 'assistant/message', seq: 3, data: { turn: 1, step: 2, message: { id: 'wrong', content: [{ type: 'text', text: '不同的原始返回' }] } } });
  assert.equal((await ctx.tavernMode.ensure(session.id)).turn, 0);
  events.push({ type: 'assistant/message', seq: 4, data: { turn: 1, step: 2, message: { id: 'native-reply', content: [{ type: 'text', text: raw }] } } });
  const result = await ctx.tavernMode.ensure(session.id);
  assert.equal(result.turn, 1); assert.equal(result.messages[0].content, processed); assert.equal(result.messages[0].nativeMessageId, 'native-reply');
});

test('Concurrent frontend snapshots preserve other cards and shared plans while applying explicit deletions', () => {
  const original = { local: { plan: 'one', old: 'remove' }, databases: [{ name: 'avatars', version: 4, stores: [{ name: 'images', keyPath: 'id', autoIncrement: false, indexes: [], records: [{ key: 'card-a', value: 'old' }] }] }] };
  const left = structuredClone(original), right = structuredClone(original);
  left.local.plan = 'two'; delete left.local.old;
  left.databases[0].stores[0].records = [{ key: 'card-a', value: 'updated' }];
  right.local.another = 'saved'; right.databases[0].stores[0].records.push({ key: 'card-b', value: 'new' });
  let merged = mergeStorage(mergeStorage(original, diffStorage(original, left)), diffStorage(original, right));
  assert.deepEqual(merged.local, { plan: 'two', another: 'saved' });
  assert.deepEqual(merged.databases[0].stores[0].records, [{ key: 'card-a', value: 'updated' }, { key: 'card-b', value: 'new' }]);
  const deleted = structuredClone(right); deleted.databases[0].stores[0].records.shift();
  merged = mergeStorage(merged, diffStorage(right, deleted));
  assert.deepEqual(merged.databases[0].stores[0].records, [{ key: 'card-b', value: 'new' }]);
  assert.deepEqual(diffStorage(original, original), { local: [], databases: [] });
});

test('The first turn waits for the frontend and uses its prepared variables before reading prompt assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-handshake-'));
  const client = Object.assign(new EventEmitter(), { readyState: 1 });
  const controller = new AbortController();
  try {
    const store = new Store(root); await store.init();
    await store.saveSession({ id: 'handshake', config: defaultConfig(), messages: [], characters: [], memories: {}, variables: {} });
    const session = { id: 'handshake', header: {}, snapshotEvents: () => [] };
    const ctx = { sessions: new Map([[session.id, session]]), sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide: (_name, value) => { ctx.tavernMode = value; } }, on: () => {}, logger: { warn() {} } };
    let assetReads = 0;
    const jobs = new Map();
    const api = installNativeService(ctx, { store, jobs, browserPayload: async state => ({ state }), sessionAssets: async state => {
      assetReads++; assert.equal(state.variables.prepared, true); assert.equal(state.injections[0].content, '气泡格式已就绪');
      assert.equal(state.userName, '前端已保存'); assert.equal(jobs.get(session.id).preparing, false);
      assert.equal(state.config.agents.advance.provider, 'fixture'); assert.equal(state.config.agents.write.model, 'fixture');
      throw new Error('prepared-assets');
    } });
    const running = ctx.tavernMode.run({ agent: { id: session.id }, messages: [{ id: 'input', content: [{ type: 'text', text: '开始' }] }], route: { provider: 'fixture', model: 'fixture' }, signal: controller.signal });
    const rejected = assert.rejects(running, /prepared-assets/);
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(assetReads, 0);
    client.send = text => {
      const event = JSON.parse(text);
      if (event.type === 'runtime') void (async () => {
        assert.equal(jobs.get(session.id).preparing, true);
        await store.exclusive(session.id, async () => {
          const state = await store.session(session.id); state.userName = '前端已保存'; await store.saveSession(state);
        });
        await api({ method: 'POST' }, {}, '/native-reply', { id: event.id, sessionId: session.id, value: { variables: { prepared: true }, injections: [{ id: 'format', position: 'in_chat', content: '气泡格式已就绪' }] } }, new URL('http://localhost'), () => {});
      })();
    };
    await ctx.tavernMode.connect('handshake', client);
    await rejected; assert.equal(assetReads, 1);
  } finally { controller.abort(); client.emit('close'); await rm(root, { recursive: true, force: true }); }
});

test('A turn keeps the frontend that prepared it when another browser connects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-client-owner-'));
  const clients = ['first', 'second'].map(() => Object.assign(new EventEmitter(), { readyState: 1 }));
  const controller = new AbortController();
  try {
    const store = new Store(root); await store.init();
    const scene = { location: '排练室', time: '夜晚', summary: '' };
    await store.saveSession({ id: 'owner', config: defaultConfig(), messages: [], characters: [], memories: {}, variables: {}, tables: {}, renderMode: 'text', scene });
    const session = { id: 'owner', header: {}, snapshotEvents: () => [] };
    const ctx = { sessions: new Map([[session.id, session]]), sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide: (_name, value) => { ctx.tavernMode = value; } }, on: () => {}, logger: { warn() {} } };
    const api = installNativeService(ctx, { store, jobs: new Map(), browserPayload: async state => ({ state }), sessionAssets: async () => ({ card: { name: '排练室', character_book: { entries: [{ id: 1, constant: true, content: '原始公告。' }] } }, extraBooks: [] }) });
    const received = [];
    const respond = name => text => {
      const event = JSON.parse(text); if (event.type !== 'runtime') return;
      received.push(`${name}:${event.method}`);
      void (async () => {
        if (event.method === 'prepare') await ctx.tavernMode.connect('owner', clients[1]);
        let value;
        if (event.method === 'worldbookScan') {
          value = { ...await activateWorldbookWithEvents(event.args.entries, event.args.options, async (name, data) => {
            if (name === 'worldinfo_scan_done' && !data.state.next) data.activated.entries.values().next().value.content = '脚本公告：{{getvar::scanReady}}';
          }), variables: { scanReady: '已就绪' } };
        } else if (event.method === 'prepare' || event.method === 'snapshot') value = { variables: {} };
        else if (event.method === 'promptReady') {
          assert.equal(event.args.entries[0].content, '脚本公告：{{getvar::scanReady}}');
          value = { messages: event.args.messages };
        } else value = { message: event.args.message.content };
        await api({ method: 'POST' }, {}, '/native-reply', { id: event.id, sessionId: session.id, value }, new URL('http://localhost'), () => {});
      })();
    };
    clients[0].send = respond('first'); clients[1].send = respond('second');
    await ctx.tavernMode.connect('owner', clients[0]);
    const state = await ctx.tavernMode.run({ agent: { id: session.id }, messages: [{ id: 'input', content: [{ type: 'text', text: '开始排练。' }] }], route: { provider: 'fixture', model: 'fixture' }, signal: controller.signal, callModel: async ({ schema, messages }) => {
      if (schema === COMBINATION) return { scene, presentCharacterIds: [], worldEntryIds: [], situation: '', characterViews: [], openThreads: [] };
      if (schema === PLAN) return { scene, beats: [], characterIntents: [], constraints: [] };
      if (schema === TABLE_UPDATE) return { scene, operations: [], worldChanges: [], participatingCharacters: [], newCharacters: [] };
      assert.ok(messages.some(message => message.content === '脚本公告：已就绪'));
      assert.ok(!messages.some(message => message.content.includes('原始公告')));
      return '排练开始了。';
    } });
    assert.equal(state.messages.at(-1).content, '排练开始了。');
    assert.deepEqual(received, ['first:prepare', 'first:worldbookScan', 'first:promptReady', 'first:messageReceived', 'first:snapshot']);
  } finally { controller.abort(); for (const client of clients) client.emit('close'); await rm(root, { recursive: true, force: true }); }
});

test('Opening a persisted Tavern session resumes it through the native controller before checking its mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-cold-'));
  try {
    const store = new Store(root); await store.init();
    await store.saveSession({ id: 'cold', messages: [], characters: [], memories: {}, variables: {} });
    const sessions = new Map(); let resumes = 0;
    const session = { id: 'cold', header: {}, snapshotEvents: () => [] };
    const ctx = { sessions, sessionController: { async resolveAgent(id) { assert.equal(id, 'cold'); resumes++; sessions.set(id, session); return { agent: { session } }; } }, sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide: (_name, value) => { ctx.tavernMode = value; } }, on: () => {}, logger: { warn() {} } };
    installNativeService(ctx, { store, jobs: new Map(), browserPayload: async state => ({ state }), sessionAssets: async () => ({}) });
    assert.equal((await ctx.tavernMode.ensure('cold')).id, 'cold');
    assert.equal((await ctx.tavernMode.ensure('cold')).id, 'cold');
    assert.equal(resumes, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
