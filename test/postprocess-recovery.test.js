import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../src/storage.js';
import { NativeRun } from '../src/native-run.js';
import { installNativeService } from '../src/native-service.js';
import { defaultConfig } from '../src/contracts.js';
import { activateWorldbookWithEvents } from '../src/worldbook.js';
import { evidenceSources, validateEvidence } from '../src/memory.js';

for (const failure of ['table', 'memory']) test(`native ${failure} failure retains prose and next distinct input resumes only unfinished updates`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-postprocess-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root); await store.init();
  const config = defaultConfig(), scene = { location: '图书馆', time: '午后', summary: '' };
  await store.saveSession({ id: 'session', turn: 0, config, messages: [{ id: 'greeting', role: 'assistant', content: '图书馆开门了。', greeting: true }], characters: [{ id: 'a', name: '林岚', enabled: true, profile: '成年管理员' }], memories: { a: [] }, tables: {}, variables: {}, userName: '访客', scene });
  const events = [], hooks = {}, session = { id: 'session', header: {}, snapshotEvents: () => events }, agent = { id: 'session', session };
  const ctx = { sessions: new Map([['session', session]]), sessionProjections: { stateOf: () => 'tavern' }, reflect: { provide(_key, value) { ctx.tavernMode = value; } }, on(name, callback) { hooks[name] = callback; }, logger: { warn(error) { throw error; } } };
  const assets = { card: { name: '图书馆' }, legacy: { plotTasks: [{ name: '推进', extractTags: 'outline', promptGroup: [{ role: 'system', content: '规划还书步骤。' }, { role: 'user', content: '$7 $8' }] }] } };
  const api = installNativeService(ctx, { store, sessionAssets: async () => assets, browserPayload: async state => ({ state }), jobs: new Map() });
  const client = Object.assign(new EventEmitter(), { readyState: 1 });
  client.send = text => {
    const event = JSON.parse(text); if (event.type !== 'runtime') return;
    void (async () => {
      const value = event.method === 'worldbookScan' ? await activateWorldbookWithEvents(event.args.entries, event.args.options, async () => {})
        : event.method === 'promptReady' ? { messages: event.args.messages }
        : event.method === 'messageReceived' ? { message: event.args.message.content } : {};
      await api({ method: 'POST' }, {}, '/native-reply', { id: event.id, sessionId: 'session', value }, new URL('http://localhost'), () => {});
    })();
  };
  await ctx.tavernMode.connect('session', client);
  const charged = [], snapshots = []; let fail = true, turn = 0;
  const model = async request => {
    charged.push(request.stage); request.onUsage?.({ inputTokens: 100, outputTokens: 10, totalTokens: 110 });
    if (['table', 'memory'].includes(request.stage) && fail && request.stage === failure) {
      // This is the exact regression: a persisted native writer message already
      // exists when the independently billed table/memory call fails.
      const saved = await ctx.tavernMode.ensure('session');
      assert.equal(saved.messages.at(-1).content, '林岚确认借书卡已经归还。');
      assert.equal(saved.messages.at(-1).nativeMessageId, 'story-1');
      throw new Error('injected postprocessing failure');
    }
    if (request.stage === 'advance') return { sections: { outline: '检查还书记录。' } };
    if (request.stage === 'write') {
      if (turn === 2) assert.ok(request.messages.some(message => message.content.includes('林岚确认借书卡已经归还。')));
      request.onReasoning?.('检查人物与借书记录。');
      return turn === 1 ? '林岚确认借书卡已经归还。' : '林岚接过另一本图书。';
    }
    const input = JSON.parse(request.messages.at(-1).content);
    if (request.stage === 'table') return { scene, operations: [], worldChanges: [], participatingCharacters: [{ characterId: 'a', evidence: { sourceId: input.sourcePassages.at(-1).passages[0].id } }], newCharacters: [] };
    if (request.stage === 'memory') return { characterId: 'a', summary: '完成图书交接。', facts: [], relationships: [], openThreads: [], stateChanges: [] };
    if (request.stage === 'recall') return { characterId: 'a', memories: [], perspective: '', likelyPresent: true };
    throw new Error('Unexpected ' + request.stage);
  };
  const drive = async text => {
    turn++;
    let run, step = 0, usage = 0;
    run = new NativeRun({ callModel: model, work: (callModel, signal) => ctx.tavernMode.run({ agent, messages: [{ id: 'input-' + turn, content: [{ type: 'text', text }] }], route: { provider: 'test', model: 'test' }, callModel, signal, turn, writeBoundary: () => ({ step: run.writeStep, text: run.writeText }) }) });
    while (true) {
      const next = await run.next(); step++;
      if (next.write) {
        run.writeStep = step;
        run.writeText = await run.execute(next.write.id, 'write', new AbortController().signal);
        const event = { type: 'assistant/message', seq: events.length, data: { turn, step, message: { id: 'story-' + turn, content: [{ type: 'text', text: run.writeText }] } } };
        events.push(event); hooks['session/event'](session, event);
      } else if (next.tasks) await Promise.all(next.tasks.map(async task => { try { await run.execute(task.id, task.stage, new AbortController().signal); } catch {} }));
      else {
        await ctx.tavernMode.stageFinal(agent, next.value, turn, run.writeStep, run.writeText);
        await ctx.tavernMode.commit(agent); usage += run.takeUsage().totalTokens; break;
      }
      usage += run.takeUsage().totalTokens;
    }
    const state = await store.session('session'); snapshots.push(state); return { state, usage };
  };
  const first = await drive('请归还借书卡。');
  assert.match(first.state.pendingUpdates.error, /injected/);
  assert.equal(first.state.turn, 1); assert.equal(first.state.messages.length, 3);
  assert.equal(first.usage, charged.length * 110); // Includes the failed call.
  const firstCalls = charged.slice(); fail = false;
  const second = await drive('再归还另一本图书。');
  assert.equal(second.state.pendingUpdates, undefined); assert.equal(second.state.turn, 2);
  assert.equal(second.state.messages.length, 5); assert.equal(second.state.messages[2].nativeMessageId, 'story-1');
  assert.deepEqual(charged.slice(firstCalls.length, firstCalls.length + (failure === 'table' ? 2 : 1)), failure === 'table' ? ['table', 'memory'] : ['memory']);
  assert.equal(charged.filter(stage => stage === 'write').length, 2);
  client.emit('close');
});

test('reasoning inside a text response is not evidence and every retained quote still maps to the original body', () => {
  const messages = [{ id: 'story', role: 'assistant', content: '<think>可能会把钥匙交给别人。\n这还只是构思。</think>\n林岚把钥匙放回自己的口袋。' }];
  const sources = evidenceSources(messages);
  assert.deepEqual(sources.map(s => s.quote), ['林岚把钥匙放回自己的口袋。']);
  for (const source of sources) validateEvidence(source, messages);
  assert.match(messages[0].content, /<think>/);
});
