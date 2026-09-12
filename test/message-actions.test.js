import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.js';
import { Store } from '../src/storage.js';
import { defaultConfig } from '../src/contracts.js';

test('Message edits persist and reroll restores the turn baseline without old memories or duplicate native messages', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-message-actions-')), disposers=[]; let handler;
  const events = [
    {seq:0,type:'session/title',data:{title:'图书馆'}},
    {seq:1,type:'turn/start',data:{turn:1}},
    {seq:2,type:'user/message',data:{id:'native-u1',content:[{type:'text',text:'第一问'}]}},
    {seq:3,type:'assistant/message',data:{turn:1,message:{id:'native-a1',content:[{type:'text',text:'第一答'}]}}},
    {seq:4,type:'turn/end',data:{turn:1}},
    {seq:5,type:'turn/start',data:{turn:2}},
    {seq:6,type:'user/message',data:{id:'native-u2',content:[{type:'text',text:'第二问'}]}},
    {seq:7,type:'assistant/message',data:{turn:2,message:{id:'native-a2',content:[{type:'text',text:'第二答'}]}}},
    {seq:8,type:'turn/end',data:{turn:2}},
  ];
  const session={id:'chat',header:{},snapshotEvents:()=>events};
  const ctx={sessions:new Map([['chat',session]]),agents:new Map(),llm:{},connection:{requestRejection:()=>null},sessionProjections:{stateOf:()=> 'tavern'},reflect:{provide(name,value){ctx[name]=value;}},on(){},effect(fn){const d=fn();if(typeof d==='function')disposers.push(d);},webServer:{register(o){handler=o.handler;return()=>{};},registerUpgrade:()=>()=>{}}};
  t.after(async()=>{for(const d of disposers.toReversed())await d();await rm(root,{recursive:true,force:true});});
  await apply(ctx,{dataDir:root});const store=new Store(root);
  await store.putItem({id:'card',kind:'card',name:'图书馆',data:{name:'图书馆'}});
  let state=await store.saveSession({id:'chat',cardId:'card',nativeSession:true,nativeAnchorSeq:0,turn:0,config:defaultConfig(),characters:[{id:'librarian',name:'管理员'}],memories:{librarian:[]},messages:[],tables:{marker:'before'},variables:{count:0},scene:{location:'门口',time:'上午',summary:''}});
  state=await store.saveSession({...state,turn:1,nativeAnchorSeq:3,messages:[{id:'u1',role:'user',content:'第一问',nativeMessageId:'native-u1',turnId:'t1'},{id:'a1',role:'assistant',content:'第一答',nativeMessageId:'native-a1',turnId:'t1'}],memories:{librarian:[{id:'m1',sourceMessageIds:['u1','a1']}]},variables:{count:1},tables:{marker:'first'},scene:{location:'阅览室',time:'上午',summary:''}});
  state=await store.saveSession({...state,turn:2,nativeAnchorSeq:7,messages:[...state.messages,{id:'u2',role:'user',content:'第二问',nativeMessageId:'native-u2',turnId:'t2'},{id:'a2',role:'assistant',content:'第二答',nativeMessageId:'native-a2',turnId:'t2'}],memories:{librarian:[...state.memories.librarian,{id:'m2',sourceMessageIds:['u2','a2']}]},variables:{count:2},tables:{marker:'second'},scene:{location:'楼上',time:'上午',summary:''},lastRun:{combination:{location:'楼上',time:'上午',summary:'',presentCharacterIds:['librarian'],worldEntryIds:[],situation:'',characterViews:[],openThreads:[]},plan:{scene:{location:'楼上',time:'上午',summary:''},beats:[],characterIntents:[],constraints:[]},recalls:[{characterId:'librarian',memories:[],queries:['第二问'],records:[],currentState:[]}]}});
  async function call(action,fields={}){let result;const req={method:'POST',url:'/api/tavern/message',async*[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({sessionId:'chat',action,...fields}));}};const res={writeHead(status){this.status=status;},end(body){result=JSON.parse(body);}};await handler(req,res);return{status:res.status,...result};}
  let result=await call('edit',{messageId:'u2',text:'修改后的第二问'});assert.equal(result.status,200,result.error);assert.equal((await store.session('chat')).messages[2].content,'修改后的第二问');
  result=await call('edit',{messageId:'a2',text:'修改后的第二答'});assert.equal(result.state.messages[3].content,'修改后的第二答');
  result=await call('rewrite',{messageId:'a2'});assert.equal(result.status,200,result.error);assert.equal(result.text,'修改后的第二问');
  assert.equal(result.state.rewrite.plan.beats.length,0);assert.equal(result.state.rewrite.recalls[0].characterId,'librarian');
  assert.equal(result.state.turn,1);assert.deepEqual(result.state.messages.map(m=>m.id),['u1','a1']);assert.deepEqual(result.state.memories.librarian.map(m=>m.id),['m1']);assert.deepEqual(result.state.tables,{marker:'first'});assert.deepEqual(result.state.variables,{count:1});assert.equal(result.state.scene.location,'阅览室');assert.deepEqual(result.state.hiddenNativeRanges,[[5,9]]);
  assert.equal((await store.session('chat',state.revision)).messages[3].content,'第二答');
  result=await call('delete',{messageId:'a1'});assert.equal(result.status,200,result.error);assert.deepEqual(result.state.messages.map(m=>m.id),['u1']);assert.ok(result.state.deletedNativeMessageIds.includes('native-a1'));assert.deepEqual(result.state.memories.librarian,[]);
  events.push({seq:9,type:'turn/start',data:{turn:3}},{seq:10,type:'user/message',data:{id:'failed-user',content:[{type:'text',text:'失败的请求'}]}},{seq:11,type:'turn/end',data:{turn:3}});
  result=await call('edit',{nativeMessageId:'failed-user',text:'修改失败轮次的输入'});assert.equal(result.status,200,result.error);assert.equal(result.state.nativeMessageOverrides['failed-user'],'修改失败轮次的输入');
  result=await call('reroll',{nativeMessageId:'failed-user'});assert.equal(result.status,200,result.error);assert.equal(result.text,'修改失败轮次的输入');assert.deepEqual(result.state.messages.map(m=>m.id),['u1']);assert.deepEqual(result.state.memories.librarian,[]);
  ctx.agents.set('chat',{status:'running'});result=await call('delete',{messageId:'u1'});assert.equal(result.status,400);assert.ok((await store.session('chat')).messages.some(m=>m.id==='u1'));
  ctx.agents.delete('chat');result=await call('reroll',{messageId:'u1',text:'修改后的首轮输入'});assert.equal(result.status,200,result.error);assert.equal(result.text,'修改后的首轮输入');assert.equal(result.state.turn,0);assert.deepEqual(result.state.messages,[]);assert.deepEqual(result.state.variables,{count:0});
});
