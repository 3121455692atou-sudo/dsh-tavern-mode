import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, atomicJson } from '../src/storage.js';
import { SharedAssets } from '../src/shared-assets.js';
import { diffStorage, avatarAlias } from '../src/runtime-snapshot.js';
test('reimporting an identical asset stores its bytes once', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-assets-'));t.after(() => rm(root,{recursive:true,force:true}));
  const store = new Store(root);await store.init();
  const bytes = Buffer.from('shared portrait');
  const [a,b] = await Promise.all([store.putAsset(bytes,'png'),store.putAsset(bytes,'png')]);
  assert.equal(a,b);assert.deepEqual(await store.asset(a),bytes);
  assert.equal((await readdir(join(root,'assets'))).length,1);
});

test('legacy avatars migrate globally, share bytes, merge concurrent chats and stay deleted after restart', async t => {
  const root=await mkdtemp(join(tmpdir(),'tavern-global-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new Store(root);await store.init();
  const make= (name, value) => ({name,keyPath:name==='avatars'?'alias':'key',autoIncrement:false,indexes:[],records:value});
  const key='card-a__林岚',bytes=Buffer.from('portrait');
  const avatar={key,value:{alias:key,name:'林岚',charId:'card-a',imageBlob:{__dsh_type:'blob',mime:'image/png',bytes:bytes.toString('base64')}}};
  const snapshot={local:{theme:'dark'},databases:[{name:'BubbleDialogueAvatars',version:4,stores:[make('avatars',[avatar]),make('config',[{key:'format_rule',value:{key:'format_rule',value:'保留会话规则'}}])]}]};
  for(const id of ['a','b']) {await mkdir(store.sessionDir(id));await atomicJson(join(store.sessionDir(id),'runtime-storage.json'),snapshot);}
  const asset=await store.putAsset(bytes,'png');
  await store.putItem({id:'bundle',kind:'bubble',data:{avatars:[{name:'林岚',assetId:asset,mimeType:'image/png'}]}});
  const shared=new SharedAssets(store);await shared.init();
  const read=(snap,name)=>snap.databases.find(d=>d.name==='BubbleDialogueAvatars').stores.find(s=>s.name===name).records;
  const a=await shared.snapshot({id:'a'}),b=await shared.snapshot({id:'b'});
  assert.deepEqual(read(a,'avatars'),read(b,'avatars'));
  assert.equal(read(a,'avatars')[0].key,avatarAlias('林岚'));
  assert.equal(read(a,'avatars')[0].value.imageBlob.assetId,asset);
  assert.equal((await readdir(join(root,'assets'))).length,1);
  const disk=await readFile(join(store.sessionDir('a'),'runtime-storage.json'),'utf8');
  assert.ok(!disk.includes('portrait')&&!disk.includes('imageBlob'));
  const changed=structuredClone(a);read(changed,'avatars').push({key:avatarAlias('周川'),value:{name:'周川',alias:avatarAlias('周川'),charId:'_global_',sourceUrl:'https://example.test/a.png'}});
  await shared.save({id:'a'},diffStorage(a,changed));
  const other=structuredClone(b);read(other,'config').find(r=>r.key==='format_rule').value.value='只改乙会话';
  await shared.save({id:'b'},diffStorage(b,other));
  assert.equal(read(await shared.snapshot({id:'b'}),'avatars').length,2);
  assert.equal(read(await shared.snapshot({id:'a'}),'config').find(r=>r.key==='format_rule').value.value,'保留会话规则');
  const prior=await shared.snapshot({id:'a'}),deleted=structuredClone(prior);
  read(deleted,'avatars').splice(0,1);await shared.save({id:'a'},diffStorage(prior,deleted));
  await rm(store.sessionDir('a'),{recursive:true});
  const restarted=new SharedAssets(store);await restarted.init();
  assert.deepEqual(read(await restarted.snapshot({id:'b'}),'avatars').map(r=>r.value.name),['周川']);
  await restarted.importBundles([{id:'bundle',kind:'bubble'}],true);
  assert.equal(read(await restarted.snapshot({id:'b'}),'avatars').length,2);
});

test('interrupted migration retains already published global assets and color names containing separators', async t => {
  const root=await mkdtemp(join(tmpdir(),'tavern-migrate-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new Store(root);await store.init();
  const shared=new SharedAssets(store);await shared.init();
  const file=join(root,'runtime','avatars.json'), partial=JSON.parse(await readFile(file,'utf8'));
  const stores=partial.storage.databases[0].stores;
  const name='Name__with__separators',alias='old-card__'+name;
  stores.find(s=>s.name==='avatars').records.push({key:alias,value:{alias,name}});
  stores.find(s=>s.name==='config').records.push({key:'color_'+alias,value:{key:'color_'+alias,value:'#abc'}});
  partial.storage=shared.normalize(partial.storage);partial.migrated=false;await atomicJson(file,partial);
  await shared.init();
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.equal(saved.storage.databases[0].stores.find(s=>s.name==='avatars').records[0].key,avatarAlias(name));
  assert.equal(saved.storage.databases[0].stores.find(s=>s.name==='config').records[0].key,'color_'+avatarAlias(name));
  assert.equal(saved.migrated,true);
});
