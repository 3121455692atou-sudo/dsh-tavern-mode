import test from 'node:test';import assert from 'node:assert/strict';
import {extractInteraction,interactionHtml} from '../src/interaction.js';
import {runTurn} from '../src/pipeline.js';
import {defaultConfig} from '../src/contracts.js';

test('A malformed interaction block is repaired through the model contract without rewriting prose', async () => {
 const before='<now_plot><content>第一段。\n\n第二段。</content></now_plot>\n';
 const after='\n<div>原卡状态栏</div>';
 const broken=before+'<tavern_ui>{"status":[],"choices":[{"label":"问候","message":"你好。",] }</tavern_ui>'+after;
 const panel={status:[],choices:[{label:'问候',message:'你好。'}]};
 const config=defaultConfig({provider:'fixture',model:'fixture'});config.playMode='normal';
 const state={id:'repair',cardId:'card',userName:'访客',config,characters:[],memories:{},messages:[],tables:{},variables:{},scene:{},renderMode:'card'};
 const calls=[];
 const result=await runTurn({state,card:{name:'图书馆'},text:'开始。',callModel:async request=>{
  calls.push(request);
  if(request.stage==='write')return broken;
  assert.equal(request.stage,'format');assert.equal(request.schema.properties.choices.type,'array');
  assert.equal(request.retries,config.protocolRetries);
  assert.ok(!request.messages.some(m=>m.content.includes('第一段。')));
  return panel;
 }});
 assert.equal(calls.length,2);
 assert.equal(result.messages.at(-1).content,before+'<tavern_ui>'+JSON.stringify(panel)+'</tavern_ui>'+after);
 assert.equal(state.messages.length,0);
});
test('Interaction panels accept the declared JSON protocol and leave ordinary prose untouched',()=>{
 const prose='状态确认\n- 时间：下午\n可选方向：去服务台。';assert.deepEqual(extractInteraction(prose),{text:prose,panel:null});
 const data={status:[{label:'时段',value:'下午'}],choices:[{label:'<参观>',message:'我去服务台咨询。'}]};
 const result=extractInteraction('正文\n<tavern_ui>'+JSON.stringify(data)+'</tavern_ui>');assert.deepEqual(result.panel,data);assert.equal(result.text,'正文\n');assert.ok(interactionHtml(data).includes('&lt;参观&gt;'));assert.ok(interactionHtml(data).includes('sendUserMessage'));
 for(const bad of ['<tavern_ui>{}</tavern_ui>','<tavern_ui>bad</tavern_ui>','<tavern_ui>{','<tavern_ui>{"status":[],"choices":[{"label":"按钮","message":3}]}</tavern_ui>'])assert.throws(()=>extractInteraction(bad));
});
