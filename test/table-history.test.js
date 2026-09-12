import test from 'node:test';
import assert from 'node:assert/strict';
import {recordTableChanges,removeTableSources} from '../src/table-history.js';
import {applyTableOperations} from '../src/tables.js';
import {deleteMessages,messageAction} from '../src/message-actions.js';

test('Saving an unchanged editor value preserves tables, scene, memories and helper text', async () => {
  const state = { messages: [{ id: 'answer', role: 'assistant', content: '原文。', nativeMessageId: 'native-answer' }], tables: { sheet_a: { name: '登记', content: [['row_id', '姓名']] } }, scene: { location: '门口' }, memories: { a: [{ id: 'memory', sourceMessageIds: ['answer'] }] }, worldHistory: [{ id: 'world', sourceMessageIds: ['answer'] }] };
  const next = applyTableOperations(state.tables, [{ op: 'insert', table: 'sheet_a', values: { row_id: 1, 姓名: '访客' } }]);
  recordTableChanges(state, next, { sourceMessageIds: ['answer'], scene: { location: '馆内' } });
  state.tables = next; state.scene = { location: '馆内' };
  for (const helper of [undefined, [{ tavernMessageId: 'answer', mes: '前端显示的原文。' }]]) {
    state.helperChat = helper;
    const before = structuredClone(state);
    await messageAction({}, state, [], { action: 'edit', messageId: 'answer', text: helper?.[0].mes ?? '原文。' });
    assert.deepEqual(state, before);
  }
});

test('Deleting either source floor removes its table effects and memories while retaining independent later edits', () => {
 const base={sheet_a:{name:'登记',content:[['row_id','姓名','状态'],[1,'访客','未登记']]}};
 const state={tables:base,scene:{location:'门口'},messages:['u1','a1','u2','a2'].map(id=>({id})),memories:{a:[{id:'m1',sourceMessageIds:['u1','a1']},{id:'m2',sourceMessageIds:['u2','a2']}]}};
 const commit=(ops,ids)=>{const next=applyTableOperations(state.tables,ops);recordTableChanges(state,next,{sourceMessageIds:ids});state.tables=next;};
 commit([{op:'update',table:'sheet_a',rowId:1,values:{状态:'已登记'}},{op:'insert',table:'sheet_a',values:{row_id:2,姓名:'同伴',状态:'等候'}}],['u1','a1']);
 commit([{op:'update',table:'sheet_a',rowId:1,values:{姓名:'新名字'}},{op:'update',table:'sheet_a',rowId:2,values:{状态:'入馆'}},{op:'insert',table:'sheet_a',values:{row_id:3,姓名:'另一位',状态:'新到'}}],['u2','a2']);
 deleteMessages(state,['u1']);
 assert.deepEqual(state.tables.sheet_a.content,[['row_id','姓名','状态'],[1,'新名字','未登记'],[3,'另一位','新到']]);
 assert.deepEqual(state.memories.a.map(m=>m.id),['m2']);
 deleteMessages(state,['a2']);assert.deepEqual(state.tables,base);assert.deepEqual(state.memories.a,[]);
});

test('Replaying retained table changes preserves SQL row ordering',()=>{
 const state={tables:{sheet_a:{name:'登记',content:[['row_id','姓名'],[3,'原有访客']]}},scene:{}};
 const next=applyTableOperations(state.tables,[{op:'insert',table:'sheet_a',values:{row_id:1,姓名:'先到访客'}}]);
 recordTableChanges(state,next,{sourceMessageIds:['kept']});state.tables=next;
 removeTableSources(state,['unrelated']);assert.deepEqual(state.tables,next);
});
