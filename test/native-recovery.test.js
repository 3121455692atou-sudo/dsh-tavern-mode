import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Store, atomicJson } from '../src/storage.js';
import { installNativeService } from '../src/native-service.js';
import { defaultConfig } from '../src/contracts.js';
import { activateWorldbookWithEvents } from '../src/worldbook.js';
import { readTurnCheckpoint } from '../src/turn-checkpoint.js';
import { turnRecovery, publicRecovery } from '../src/native-recovery.js';

for (const failure of ['识别角色', '召回', '世界观', '推进', '写作', '表格更新', '林岚']) test(`GUI resume after ${failure} failure reuses paid stages and preserves the original user message`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-native-resume-')); t.after(() => rm(root, { recursive: true, force: true }));
  let store = new Store(root); await store.init();
  const scene = { location: '图书馆', time: '下午', summary: '' };
  const state = await store.saveSession({ id: 'session', turn: 0, config: defaultConfig(), needsRoster: true,
    userName: '访客', messages: [{ id: 'greeting', role: 'assistant', content: '图书馆开门了。', greeting: true }], characters: [], memories: {}, tables: {}, variables: {}, scene });
  const events = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { id: 'original-user', role: 'user', content: [{ type: 'text', text: '请归还借书卡。' }] } }];
  const session = { id: state.id, header: {}, snapshotEvents: () => events }, agent = { id: state.id, session };
  const assets = { card: { name: '图书馆', description: '林岚是一位成年图书管理员。' }, legacy: { plotTasks: ['召回', '世界观', '推进'].map((name, i) => ({ name, stage: i + 1, extractTags: 'section' + i, promptGroup: [{ role: 'system', content: '简短规划还书步骤。' }, { role: 'user', content: '$7 $8' }] })) } };
  let ctx, api, client; const runtimeCalls = [], charged = []; let failing = true;
  async function connect() {
    ctx = { sessions: new Map([[session.id, session]]), sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide(_name, value) { ctx.tavernMode = value; } }, on() {}, logger: { warn(e) { throw e; } } };
    api = installNativeService(ctx, { store, jobs: new Map(), browserPayload: async state => ({ state }), sessionAssets: async () => assets });
    client = Object.assign(new EventEmitter(), { readyState: 1 });
    client.send = text => {
      const event = JSON.parse(text); if (event.type !== 'runtime') return;
      runtimeCalls.push(event.method);
      void (async () => {
        const value = event.method === 'prepare' ? { variables: { prepared: 1 }, injections: [] }
          : event.method === 'resume' ? { variables: { prepared: 999 }, injections: [] }
          : event.method === 'worldbookScan' ? await activateWorldbookWithEvents(event.args.entries, event.args.options, async () => {})
          : event.method === 'promptReady' ? { messages: event.args.messages }
          : event.method === 'messageReceived' ? { message: event.args.message.content } : {};
        await api({ method: 'POST' }, {}, '/native-reply', { id: event.id, sessionId: session.id, value }, new URL('http://localhost'), () => {});
      })();
    };
    await ctx.tavernMode.connect(session.id, client);
  }
  const model = async request => {
    charged.push(request.label);
    if (failing && request.label === failure) throw Object.assign(new Error('injected failure'), { code: 'TAVERN_TIMEOUT' });
    if (request.stage === 'roster') return { characters: [{ name: '林岚', profile: '成年管理员', worldbookIds: [] }] };
    if (request.stage === 'advance') return { sections: Object.fromEntries(Object.keys(request.schema.properties.sections.properties).map(key => [key, '核对还书记录。'])) };
    if (request.stage === 'write') { assert.ok(request.messages.some(m => m.content.includes('请归还借书卡。'))); assert.ok(!request.messages.some(m => m.content.includes('/tavern-resume'))); return '林岚确认借书卡已经归还。'; }
    const input = JSON.parse(request.messages.at(-1).content);
    if (request.stage === 'table') return { scene, operations: [], worldChanges: [], participatingCharacters: [{ characterId: input.characters[0].id, evidence: { sourceId: input.sourcePassages.at(-1).passages[0].id } }], newCharacters: [] };
    if (request.stage === 'memory') return { characterId: input.character.id, summary: '完成图书交接。', facts: [], relationships: [], openThreads: [], stateChanges: [] };
    throw new Error('Unexpected ' + request.stage);
  };
  const drive = (text, nativeId) => ctx.tavernMode.run({ agent, messages: [{ id: nativeId, content: [{ type: 'text', text }] }], route: { provider: 'test', model: 'test' }, callModel: model, signal: new AbortController().signal, turn: 1 });
  const commit = async result => {
    if (!result.updatesOnly) {
      await ctx.tavernMode.stageFinal(agent, result, 1, 1);
      events.push({ type: 'assistant/message', seq: events.length, data: { turn: 1, step: 1, message: { id: 'native-story', content: [{ type: 'text', text: result.messages.at(-1).content }] } } });
    }
    await ctx.tavernMode.commit(agent);
  };
  await connect();
  const post = ['表格更新', '林岚'].includes(failure);
  if (post) { const partial = await drive('请归还借书卡。', 'original-user'); assert.ok(partial.pendingUpdates); await commit(partial); }
  else await assert.rejects(drive('请归还借书卡。', 'original-user'), /injected/);
  let payload;
  await api({ method: 'GET' }, {}, '/native-state', {}, new URL('http://localhost/?id=session'), (_res, value) => { payload = value; });
  assert.equal(payload.recovery.label, failure);
  assert.equal(payload.recovery.kind, post ? 'updates' : 'turn');
  assert.equal(payload.recovery.request, undefined); // private prompt snapshot never sent in recovery metadata
  if (failure === '推进') assert.equal(payload.recovery.completedSteps, 3);
  if (!post) assert.equal(payload.state.messages.length, 1);
  const successful = charged.filter(label => label !== failure), before = charged.length;
  client.emit('close'); store = new Store(root); await connect(); failing = false;
  const command = '/tavern-resume ' + payload.recovery.token;
  events.push({ type: 'turn/start', data: { turn: 2 } }, { type: 'user/message', data: { id: 'retry-control', content: [{ type: 'text', text: command }] } });
  const result = await drive(command, 'retry-control'); await commit(result);
  assert.equal(result.pendingUpdates, undefined); assert.equal(result.turn, 1);
  assert.equal(result.messages.length, 3); assert.equal(result.messages[1].content, '请归还借书卡。');
  assert.equal(result.messages[1].nativeMessageId, 'original-user');
  for (const label of successful) assert.equal(charged.filter(value => value === label).length, 1, label + ' must not be sent again');
  assert.ok(charged.slice(before).includes(failure));
  assert.equal(runtimeCalls.filter(method => method === 'prepare').length, 1);
  assert.equal(runtimeCalls.filter(method => method === 'resume').length, 1);
  assert.equal(await readTurnCheckpoint(store, state.id), null);
  assert.equal(await turnRecovery(store, await store.session(state.id), session), null);
  client.emit('close');
});

test('rc.4 checkpoints recover original native event shape and failure label without a saved request', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-old-resume-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root); await store.init();
  const state = await store.saveSession({ id: 'old', messages: [], memories: {}, characters: [], tables: {} });
  await atomicJson(join(store.sessionDir(state.id), 'turn-checkpoint.json'), { scope: 'old', identity: { seed: 'old-seed' }, results: { saved: { value: {} } } });
  const events = [{ type: 'turn/start', data: {} }, { type: 'user/message', data: { id: 'input', content: [{ type: 'text', text: '归还图书。' }] } },
    { type: 'tool/call', data: { callId: 'failed', name: 'tavern_advance', arguments: '{"label":"推进"}' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'failed', isError: true, content: [{ type: 'text', text: 'Error: timeout' }] }] } } }];
  const recovery = await turnRecovery(store, state, { snapshotEvents: () => events });
  assert.equal(recovery.label, '推进'); assert.equal(recovery.completedSteps, 1);
  assert.deepEqual(recovery.request, { text: '归还图书。', nativeMessageId: 'input' });
  assert.equal(publicRecovery(recovery).request, undefined);
});
