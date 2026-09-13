import test from 'node:test';
import assert from 'node:assert/strict';
import { makeModelCaller } from '../src/model.js';

test('Preset reasoning applies only to a supported effort, while explicit agent choices stay explicit', async () => {
  const calls=[];
  let reasoning;
  const call=makeModelCaller({resolveModelInfo:async()=>({reasoning}),stream:async function*(options){calls.push(options);yield {type:'text-delta',text:'完成'};yield {type:'finish',reason:{kind:'stop'}};}});
  const agent={provider:'fixture',model:'model',presetReasoningEffort:'high'};
  await call({agent,messages:[]});assert.equal(calls.at(-1).reasoningEffort,undefined);
  reasoning={efforts:[{id:'low'},{id:'high'}]};
  await call({agent,messages:[]});assert.equal(calls.at(-1).reasoningEffort,'high');
  await call({agent:{...agent,reasoningEffort:'low'},messages:[]});assert.equal(calls.at(-1).reasoningEffort,'low');
  reasoning={efforts:[{id:'low'}]};
  await call({agent,messages:[]});assert.equal(calls.at(-1).reasoningEffort,undefined);
});

test('Structured work prefers supported low reasoning without changing writer or explicit choices', async () => {
  const requests = [], schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  let efforts = [{ id: 'low' }, { id: 'high' }];
  const call = makeModelCaller({ resolveModelInfo: async () => ({ reasoning: { efforts } }), stream: async function* (options) {
    requests.push(options);
    if (options.tools) yield { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'tavern_result', arguments: '{"ok":true}' } };
    else yield { type: 'text-delta', text: '正文' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  const agent = { provider: 'fixture', model: 'fixture' };
  await call({ agent, messages: [], schema }); assert.equal(requests.at(-1).reasoningEffort, 'low');
  await call({ agent, messages: [] }); assert.equal(requests.at(-1).reasoningEffort, undefined);
  await call({ agent: { ...agent, reasoningEffort: 'high' }, messages: [], schema }); assert.equal(requests.at(-1).reasoningEffort, 'high');
  await call({ agent: { ...agent, presetReasoningEffort: 'high' }, messages: [], schema }); assert.equal(requests.at(-1).reasoningEffort, 'high');
  efforts = [{ id: 'high' }];
  await call({ agent, messages: [], schema }); assert.equal(requests.at(-1).reasoningEffort, undefined);
});
