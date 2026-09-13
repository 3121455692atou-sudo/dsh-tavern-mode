import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, COMBINATION, PLAN, TABLE_UPDATE } from '../src/contracts.js';
import { makeModelCaller } from '../src/model.js';
import { runTurn } from '../src/pipeline.js';

test('Unconfigured agents leave output limits to the provider, while explicit limits reach the request', async () => {
  const calls = [];
  const call = makeModelCaller({ stream: async function* (options) { calls.push(options); yield { type: 'text-delta', text: '完成' }; yield { type: 'finish', reason: { kind: 'stop' } }; } });
  for (const agent of Object.values(defaultConfig({ provider: 'fixture', model: 'fixture' }).agents)) await call({ agent, messages: [{ role: 'user', content: '检查' }] });
  assert.ok(calls.every(request => !Object.hasOwn(request, 'maxTokens')));
  await call({ agent: { provider: 'fixture', model: 'fixture', maxTokens: 23456 }, messages: [{ role: 'user', content: '检查' }] });
  assert.equal(calls.at(-1).maxTokens, 23456);
});

test('Writing does not inherit a preset output token limit', async () => {
  for (const [limit, preset, expected] of [[null, undefined, null], [null, { openai_max_tokens: 25000 }, null], [30000, { openai_max_tokens: 25000 }, 30000]]) {
    const config = defaultConfig({ provider: 'fixture', model: 'fixture' }); config.agents.write.maxTokens = limit;
    const scene = { location: '图书馆', time: '上午', summary: '' };
    const state = { id: 'limits', cardId: 'card', userName: '访客', config, characters: [], memories: {}, messages: [], tables: {}, variables: {}, scene };
    await runTurn({ state, card: { name: '图书馆' }, preset, text: '开始参观。', callModel: async ({ schema, agent }) => {
      if (schema === COMBINATION) return { scene, presentCharacterIds: [], worldEntryIds: [], situation: '', characterViews: [], openThreads: [] };
      if (schema === PLAN) return { scene, beats: [], characterIntents: [], constraints: [] };
      if (schema === TABLE_UPDATE) return { scene, operations: [], worldChanges: [], participatingCharacters: [], newCharacters: [] };
      assert.equal(agent.maxTokens ?? null, expected); return '图书馆开门了。';
    } });
  }
});

test('Writing keeps truncated output instead of failing the turn', async () => {
  const call = makeModelCaller({ stream: async function* () {
    yield { type: 'text-delta', text: '未写完的正文' };
    yield { type: 'finish', reason: { kind: 'max-tokens' } };
  } });
  assert.equal(await call({ agent: { provider: 'fixture', model: 'fixture' }, messages: [{ role: 'user', content: '写' }] }), '未写完的正文');
});

test('Structured tasks do not retry a truncated tool call at the same output limit', async () => {
  let calls = 0;
  const call = makeModelCaller({ stream: async function* () {
    calls++;
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'tavern_result', arguments: '{"ok":' } };
    yield { type: 'finish', reason: { kind: 'max-tokens' } };
  } });
  await assert.rejects(() => call({ agent: { provider: 'fixture', model: 'fixture' }, messages: [{ role: 'user', content: '填' }], schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }));
  assert.equal(calls, 1);
});
