import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/native-agent.js';

for (const mode of ['streamed', 'final', 'multiple']) test(`native reasoning preserves each block once (${mode})`, async () => {
  const hooks = new Map(), agent = { id: 'session', session: {} };
  apply({
    on: (name, callback) => hooks.set(name, callback), effect() {},
    agents: new Map([[agent.id, agent]]), tools: { register() {} },
    sessionProjections: { stateOf: () => 'tavern' },
    tavernMode: {
      run: async ({ callModel }) => ({ messages: [{ content: await callModel({ stage: 'write', agent: { provider: 'fixture', model: 'fixture' }, messages: [] }) }] }),
      stageFinal: async () => {},
    },
    llm: { async *stream() {
      if (mode !== 'final') yield { type: 'reasoning-delta', index: 0, text: '核对节拍。' };
      yield { type: 'text-delta', index: 1, text: '排练开始。' };
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '核对节拍。' } };
      if (mode === 'multiple') yield { type: 'block-end', index: 2, block: { type: 'reasoning', text: '检查下一个小节。' } };
      yield { type: 'block-end', index: 1, block: { type: 'text', text: '排练开始。' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } },
  });
  await hooks.get('agent/pre-step')({ agent, turn: 1, step: 1, messages: [] }, () => {});
  const chunks = [];
  for await (const chunk of hooks.get('llm/stream')({ sessionId: agent.id }, () => {})) chunks.push(chunk);
  assert.deepEqual(chunks.filter(c => c.type === 'block-end' && c.block.type === 'reasoning').map(c => c.block.text), mode === 'multiple' ? ['核对节拍。', '检查下一个小节。'] : ['核对节拍。']);
  assert.deepEqual(chunks.filter(c => c.type === 'block-end' && c.block.type === 'text').map(c => c.block.text), ['排练开始。']);
});
