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
