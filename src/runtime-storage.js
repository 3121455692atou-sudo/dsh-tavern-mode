// Browser-only persistence adapter for the isolated Tavern document.
import * as fake from 'fake-indexeddb';
import { diffStorage } from './runtime-snapshot.js';

const complete = transaction => new Promise((resolve, reject) => { transaction.addEventListener('complete', resolve); transaction.addEventListener('error', () => reject(transaction.error)); transaction.addEventListener('abort', () => reject(transaction.error)); });
const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const bytesToBase64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
export const base64ToBytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));

const assetRefs = new Map();
async function encode(value, assets) {
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const blob = value instanceof Blob, mime = blob ? value.type : '';
    const bytes = blob ? new Uint8Array(await value.arrayBuffer()) : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    if (!assets?.saveAsset) return { __dsh_type: blob ? 'blob' : 'buffer', mime, bytes: bytesToBase64(bytes) };
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const key = hash + ':' + mime;
    if (!assetRefs.has(key)) assetRefs.set(key, await assets.saveAsset(bytesToBase64(bytes),mime));
    return { __dsh_type: blob ? 'blob' : 'buffer', mime, assetId: assetRefs.get(key) };
  }
  if (value instanceof Date) return { __dsh_type: 'date', value: value.toISOString() };
  if (Array.isArray(value)) return Promise.all(value.map(v=>encode(v,assets)));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key,item])=>[key,await encode(item,assets)])));
  return value;
}
async function decode(value, assets) {
  if (value?.__dsh_type === 'blob' || value?.__dsh_type === 'buffer') {
    const bytes = base64ToBytes(value.assetId ? await assets.loadAsset(value.assetId) : value.bytes);
    if (value.assetId) assetRefs.set(value.assetId.split('.')[0] + ':' + (value.mime ?? ''),value.assetId);
    return value.__dsh_type === 'blob' ? new Blob([bytes],{type:value.mime}) : bytes.buffer;
  }
  if (value?.__dsh_type === 'date') return new Date(value.value);
  if (Array.isArray(value)) return Promise.all(value.map(v=>decode(v,assets)));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key,item])=>[key,await decode(item,assets)])));
  return value;
}

export async function installStorage(snapshot, save, assets) {
  for (const [name, value] of Object.entries(fake)) if (name.startsWith('IDB') || name === 'indexedDB') Object.defineProperty(window, name, { configurable: true, value });
  const local = new Map(Object.entries(snapshot?.local ?? {}));
  let ready = false, timer, baseline = snapshot ?? {}, writes = Promise.resolve();
  const persist = () => {
    const work = async () => {
      const next = await dump(), patch = diffStorage(baseline, next);
      if (patch.local.length || patch.databases.length) await save(patch);
      baseline = next;
    };
    writes = writes.then(work, work); return writes;
  };
  const schedule = () => { if (ready) { clearTimeout(timer); timer = setTimeout(() => persist().catch(error => console.error(error)), 1000); } };
  const localStore = { getItem: key => local.has(String(key)) ? local.get(String(key)) : null, setItem: (key, value) => { local.set(String(key), String(value)); schedule(); }, removeItem: key => { local.delete(String(key)); schedule(); }, clear: () => { local.clear(); schedule(); }, key: index => [...local.keys()][index] ?? null, get length() { return local.size; } };
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { configurable: true, value: localStore });
  const originalTransaction = fake.IDBDatabase.prototype.transaction;
  fake.IDBDatabase.prototype.transaction = function (...args) {
    const tx = originalTransaction.apply(this, args);
    if (args[1] === 'readwrite') tx.addEventListener('complete', schedule);
    return tx;
  };
  for (const database of snapshot?.databases ?? []) {
    const opening = indexedDB.open(database.name, database.version);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      for (const store of database.stores) {
        const target = db.createObjectStore(store.name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement });
        for (const index of store.indexes) target.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
      }
    };
    const db = await request(opening);
    if (database.stores.length) {
      const decoded = await Promise.all(database.stores.map(async store => ({ ...store, records: await Promise.all(store.records.map(async record => ({ key: await decode(record.key,assets), value: await decode(record.value,assets) }))) })));
      const tx = db.transaction(database.stores.map(s => s.name), 'readwrite');
      const done = complete(tx);
      for (const store of decoded) for (const record of store.records) {
        const target = tx.objectStore(store.name);
        if (store.keyPath === null) target.put(record.value, record.key);
        else target.put(record.value);
      }
      await done;
    }
    db.close();
  }
  ready = true;
  async function dump() {
    const databases = [];
    for (const entry of await indexedDB.databases()) {
      const db = await request(indexedDB.open(entry.name, entry.version));
      const stores = [];
      for (const name of [...db.objectStoreNames]) {
        const tx = db.transaction(name, 'readonly');
        const store = tx.objectStore(name);
        const indices = [...store.indexNames].map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; });
        const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
        stores.push({ name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes: indices, records: await Promise.all(values.map(async (value, i) => ({ key: await encode(keys[i],assets), value: await encode(value,assets) }))) });
      }
      databases.push({ name: entry.name, version: entry.version, stores });
      db.close();
    }
    return { local: Object.fromEntries(local), databases };
  }
  return { dump, flush: async () => { clearTimeout(timer); await persist(); } };
}

export async function bubbleRecord(storeName, key) {
  const entry = (await indexedDB.databases()).find(db => db.name === 'BubbleDialogueAvatars');
  if (!entry) return null;
  const db = await request(indexedDB.open(entry.name, entry.version));
  try { return await request(db.transaction(storeName).objectStore(storeName).get(key)); }
  finally { db.close(); }
}
