import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.js';
import { Store } from '../src/storage.js';
import { defaultConfig } from '../src/contracts.js';
import { assembleWritingPrompt } from '../src/prompts.js';
import { Session } from '@deepseek-ai/dsh-session';
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';

test('Script-created narrator messages persist, preserve variable indices, and get native branch boundaries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-chat-api-'));
  const disposers = [], events = []; let handler;
  const native = Session.create('chat'); native.append('session/title', { title: '角色会话' });
  const session = { id: native.id, snapshotEvents: () => native.snapshotEvents(), append(type, data) { const event = native.append(type, data); events.push(event); return event; } };
  const ctx = { sessions: new Map([['chat', session]]), agents: new Map(), llm: {}, agentDefaultModel: {}, connection: { requestRejection: () => null }, sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide(name, value) { ctx[name] = value; } }, on() {}, effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); }, webServer: { register(options) { handler = options.handler; return () => {}; }, registerUpgrade: () => () => {} } };
  t.after(async () => { for (const dispose of disposers.toReversed()) await dispose(); await rm(root, { recursive: true, force: true }); });
  await apply(ctx, { dataDir: root });
  const store = new Store(root);
  await store.putItem({ id: 'card', kind: 'card', name: '角色', data: { name: '角色' } });
  await store.saveSession({ id: 'chat', cardId: 'card', nativeSession: true, nativeAnchorSeq: -1, userName: '访客', config: defaultConfig(), renderMode: 'text', characters: [], memories: {}, tables: {}, messages: [{ id: 'first', role: 'assistant', content: '开场' }, { id: 'last', role: 'user', content: '原有输入' }], messageVariables: { 0: [{ stamina: 100 }], 1: [{ stamina: 90 }] } });
  async function call(method, args) {
    let body;
    const req = { method: 'POST', url: '/api/tavern/runtime', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ sessionId: 'chat', method, args })); } };
    const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(value) { body = JSON.parse(value); } };
    await handler(req, res); return { status: res.status, ...body };
  }
  const created = await call('createChat', { before: 1, messages: [{ role: 'system', name: 'system', message: '角色档案：成年维修师。', data: { stamina: 95 } }] });
  assert.equal(created.status, 200);
  assert.doesNotThrow(() => validateStoredEvents(native.header, structuredClone(native.snapshotEvents())));
  assert.equal(created.state.messages[1].role, 'system');
  assert.equal(created.state.messages[1].extra.type, 'narrator');
  assert.equal(created.state.messages[1].is_hidden, false);
  assert.equal(created.state.messageVariables[1][0].stamina, 95);
  assert.equal(created.state.messageVariables[2][0].stamina, 90);
  assert.equal(created.state.nativeAnchorSeq, 0);
  const helper = created.state.messages.map(message => ({ tavernMessageId: message.id, mes: message.content, is_system: message.id === 'last' }));
  const edited = await call('editChat', { chat: helper });
  const prompt = await assembleWritingPrompt({ state: edited.state, card: { name: '角色' }, worldbook: [] });
  assert.ok(prompt.messages.some(message => message.role === 'system' && message.content === '角色档案：成年维修师。'));
  assert.ok(!prompt.messages.some(message => message.content === '原有输入'));
  const revision = edited.state.revision;
  const rejected = await call('createChat', { before: -1, messages: [{ role: 'system', name: 'system', message: 'invalid' }] });
  assert.equal(rejected.status, 400); assert.equal((await store.session('chat')).revision, revision);
  const deleted = await call('deleteChat', { ids: [created.value.created[0].id] });
  assert.deepEqual(deleted.state.messages.map(message => message.id), ['first', 'last']);
  assert.equal(deleted.state.nativeAnchorSeq, 0);
  assert.deepEqual(events, []);
  assert.doesNotThrow(() => Session.create('chat', validateStoredEvents(native.header, structuredClone(native.snapshotEvents())), native.header));
  await t.test('Auxiliary generation follows a pending native model change before the next turn', async () => {
    ctx.agents.set('chat', { options: { provider: 'old', model: 'old' } });
    ctx.sessionProjections.stateOf = (_session, key) => key === 'modelSelection' ? { pending: { provider: 'selected', model: 'new' }, lastUsed: { provider: 'previous', model: 'old' } } : 'tavern';
    ctx.llm.stream = async function* (options) {
      assert.equal(options.provider, 'selected'); assert.equal(options.model, 'new');
      yield { type: 'text-delta', text: '正常' }; yield { type: 'finish', reason: { kind: 'stop' } };
    };
    const result = await call('generate', { raw: true, ordered_prompts: [{ role: 'user', content: '检查' }], max_tokens: 32 });
    assert.equal(result.status, 200); assert.equal(result.value, '正常');
  });
});
