import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, atomicJson } from './storage.js';
import { diffStorage, mergeStorage, avatarAlias } from './runtime-snapshot.js';

const DB = 'BubbleDialogueAvatars';
const sharedStore = name => ['avatars', 'mood_avatars'].includes(name);
const sharedConfig = key => String(key).startsWith('color_') || String(key).startsWith('dsh_bubble_bundle_');
const extension = mime => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' })[mime] ?? 'bin';
const schema = (name, keyPath) => ({ name, keyPath, autoIncrement: false, indexes: [], records: [] });
const empty = () => ({ local: {}, databases: [{ name: DB, version: 4, stores: [schema('avatars','alias'),schema('mood_avatars','id'),schema('config','key'),schema('local_fonts','id'),schema('cg_groups','id'),schema('cg_images','id')] }] });

// Only asset records are global; the remaining script settings stay with the chat.
export function splitAssetStorage(snapshot) {
  const local = structuredClone(snapshot), shared = empty();
  const database = local.databases?.find(db => db.name === DB);
  if (database) for (const store of database.stores) {
    const target = shared.databases[0].stores.find(s => s.name === store.name);
    if (!target) continue;
    target.records = store.records.filter(row => sharedStore(store.name) || sharedConfig(row.key));
    store.records = store.records.filter(row => !sharedStore(store.name) && !sharedConfig(row.key));
  }
  return { local, shared };
}

export class SharedAssets {
  constructor(store) { this.store = store; this.file = join(store.root,'runtime','avatars.json'); }
  async externalize(value) {
    if (value?.__dsh_type === 'blob' || value?.__dsh_type === 'buffer') {
      if (value.assetId) return value;
      return { __dsh_type: value.__dsh_type, mime: value.mime, assetId: await this.store.putAsset(Buffer.from(value.bytes,'base64'), extension(value.mime)) };
    }
    if (Array.isArray(value)) return Promise.all(value.map(v => this.externalize(v)));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k,v]) => [k,await this.externalize(v)])));
    return value;
  }
  normalize(snapshot) {
    const result = structuredClone(snapshot);
    const aliases = new Map(result.databases?.find(db => db.name === DB)?.stores.find(store => store.name === 'avatars')?.records.filter(row => row.value?.name).map(row => [row.key,avatarAlias(row.value.name)]) ?? []);
    for (const db of result.databases ?? []) if (db.name === DB) for (const store of db.stores) {
      const rows = new Map();
      for (const row of store.records) {
        if (sharedStore(store.name) && row.value?.name) {
          const alias = avatarAlias(row.value.name);
          row.value.charId = '_global_';
          if (store.name === 'avatars') row.key = row.value.alias = alias;
          else { row.key = row.value.id = `${alias}__${row.value.moodId}`;row.value.alias = row.value.name.trim().toLowerCase(); }
        } else if (store.name === 'config' && String(row.key).startsWith('color_')) {
          const alias = String(row.key).slice('color_'.length);
          row.key = row.value.key = 'color_' + (aliases.get(alias) ?? (alias.startsWith('_global___') ? alias : avatarAlias(alias.slice(alias.indexOf('__') + 2))));
        }
        rows.set(JSON.stringify(row.key),row);
      }
      store.records = [...rows.values()];
    }
    return result;
  }
  async init() {
    await mkdir(join(this.store.root,'runtime'),{recursive:true,mode:0o700});
    const prior = await readJson(this.file,null);
    if (prior?.migrated) { await this.importBundles(); return; }
    await this.store.deduplicateAssets();
    let shared = prior?.storage ?? empty();
    const files = [join(this.store.root,'runtime','storage.json'),...(await readdir(join(this.store.root,'sessions'))).map(id => join(this.store.sessionDir(id),'runtime-storage.json'))];
    const existing = [];
    for (const file of files) { try { existing.push({file,mtime:(await stat(file)).mtimeMs}); } catch(error) { if(error.code!=='ENOENT')throw error; } }
    const locals = [];
    for (const {file} of existing.sort((a,b)=>a.mtime-b.mtime)) {
      const split = splitAssetStorage(await this.externalize(await readJson(file)));
      shared = mergeStorage(shared,diffStorage(empty(),this.normalize(split.shared)));
      locals.push({file,value:split.local});
    }
    // Publish assets before removing their old per-session copies.
    await atomicJson(this.file,{storage:shared,imported:prior?.imported ?? {},migrated:false});
    for(const {file,value} of locals)await atomicJson(file,value);
    await atomicJson(this.file,{storage:shared,imported:prior?.imported ?? {},migrated:true});
    await this.importBundles();
  }
  async importBundles(items, force = false) {
    return this.store.exclusive('shared-assets',async () => {
      const global = await readJson(this.file); let changed = false;
      const list = items ?? (await this.store.library()).filter(i=>i.kind==='bubble').sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt));
      for (const summary of list) {
        if(summary.kind!=='bubble' || (!force && global.imported[summary.id]))continue;
        const item = await this.store.item(summary.id), add = empty(), stores = add.databases[0].stores;
        for(const [field,name] of [['avatars','avatars'],['moodAvatars','mood_avatars']])for(const entry of item.data[field]??[]) {
          const alias = avatarAlias(entry.name), key = name==='avatars'?alias:`${alias}__${entry.moodId}`;
          const value = { ...entry, charId:'_global_', alias:name==='avatars'?alias:entry.name.trim().toLowerCase(), ...(name==='mood_avatars'?{id:key}:{}), imageBlob:entry.assetId?{__dsh_type:'blob',mime:entry.mimeType??'image/png',assetId:await this.store.putAsset(await this.store.asset(entry.assetId),extension(entry.mimeType??'image/png'))}:null, sourceUrl:entry.sourceUrl??null };
          // Migration keeps existing manually imported portraits; explicit import replaces them.
          const prior = global.storage.databases[0].stores.find(s=>s.name===name).records.some(row=>row.key===key);
          if(force || !prior)stores.find(s=>s.name===name).records.push({key,value});
        }
        for(const [name,color] of Object.entries(item.data.colors??{})) {
          const key='color_'+avatarAlias(name);
          if(force || !global.storage.databases[0].stores.find(s=>s.name==='config').records.some(row=>row.key===key))stores.find(s=>s.name==='config').records.push({key,value:{key,value:color}});
        }
        global.storage=mergeStorage(global.storage,diffStorage(empty(),add));global.imported[item.id]=true;changed=true;
      }
      if(changed)await atomicJson(this.file,global);
      return changed;
    });
  }
  async snapshot(state) {
    return this.store.exclusive('shared-assets',async () => {
      const file=join(this.store.sessionDir(state.id),'runtime-storage.json');
      let local=await readJson(file,null);
      if(!local) {
        const defaults=await readJson(join(this.store.root,'runtime','storage.json'),{});
        local=state.parentSessionId?await readJson(join(this.store.sessionDir(state.parentSessionId),'runtime-storage.json'),defaults):defaults;
        local=splitAssetStorage(local).local;await atomicJson(file,local);
      }
      const global=await readJson(this.file);
      return mergeStorage(local,diffStorage({},global.storage));
    });
  }
  async save(state, patch) {
    return this.store.exclusive('shared-assets',async () => {
      const file=join(this.store.sessionDir(state.id),'runtime-storage.json'), global=await readJson(this.file);
      const before=mergeStorage(await readJson(file,{}),diffStorage({},global.storage));
      const next=this.normalize(await this.externalize(mergeStorage(before,patch)));
      const split=splitAssetStorage(next), changed=JSON.stringify(global.storage)!==JSON.stringify(split.shared);
      if(changed)await atomicJson(this.file,{...global,storage:split.shared});
      await atomicJson(file,split.local);
      return changed;
    });
  }
}
