import { mkdir, readFile, writeFile, rename, readdir, link } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export function safeId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('无效的数据标识');
  return value;
}

export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw error; }
}

export async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, path);
}

export class Store {
  constructor(root) { this.root = root; this.locks = new Map(); }
  async init() {
    for (const name of ['', 'library', 'sessions', 'assets']) await mkdir(join(this.root, name), { recursive: true, mode: 0o700 });
  }
  async exclusive(key, work) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const done = new Promise(resolve => { release = resolve; });
    this.locks.set(key, done);
    await previous;
    try { return await work(); }
    finally { release(); if (this.locks.get(key) === done) this.locks.delete(key); }
  }
  async settings() { return readJson(join(this.root, 'settings.json'), {}); }
  async saveSettings(value) { await atomicJson(join(this.root, 'settings.json'), value); }
  async putAsset(bytes, extension = 'bin') {
    if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error('无效的资源格式');
    const id = `${createHash('sha256').update(bytes).digest('hex')}.${extension === 'jpeg' ? 'jpg' : extension}`;
    try { await writeFile(join(this.root, 'assets', id), bytes, { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return id;
  }
  async asset(id) {
    if (!/^(?:[a-f0-9-]{36}|[a-f0-9]{64})\.[a-z0-9]{1,8}$/.test(id)) throw new Error('无效的资源标识');
    return readFile(join(this.root, 'assets', id));
  }
  async deduplicateAssets() {
    for (const file of await readdir(join(this.root, 'assets'))) {
      if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/.test(file)) continue;
      const id = await this.putAsset(await this.asset(file), file.split('.').at(-1));
      const target = join(this.root, 'assets', file), temp = target + '.' + randomUUID() + '.tmp';
      await link(join(this.root, 'assets', id), temp); await rename(temp, target);
    }
  }
  async putItem(item) {
    const result = { ...item, id: item.id || randomUUID(), updatedAt: new Date().toISOString() };
    await atomicJson(join(this.root, 'library', `${safeId(result.id)}.json`), result);
    return result;
  }
  async item(id) { return readJson(join(this.root, 'library', `${safeId(id)}.json`)); }
  async library() {
    const files = await readdir(join(this.root, 'library'));
    return Promise.all(files.filter(f => f.endsWith('.json')).map(async file => {
      const { data, ...item } = await readJson(join(this.root, 'library', file));
      return item;
    }));
  }
  sessionDir(id) { return join(this.root, 'sessions', safeId(id)); }
  async session(id, revision) {
    const base = this.sessionDir(id);
    const head = revision ? { revision: safeId(revision) } : await readJson(join(base, 'head.json'));
    const dir = join(base, 'revisions', safeId(head.revision));
    const state = await readJson(join(dir, 'state.json'));
    const memories = {};
    for (const character of state.characters) memories[character.id] = await readJson(join(dir, 'memories', `${safeId(character.id)}.json`), []);
    return { ...state, revision: head.revision, memories };
  }
  async saveSession(state, { publish = true } = {}) {
    const base = this.sessionDir(state.id);
    const revision = randomUUID();
    const dir = join(base, 'revisions', revision);
    await mkdir(join(dir, 'memories'), { recursive: true, mode: 0o700 });
    const { memories = {}, revision: previousRevision, ...data } = state;
    data.updatedAt = new Date().toISOString();
    data.previousRevision = previousRevision ?? null;
    for (const character of data.characters) {
      await atomicJson(join(dir, 'memories', `${safeId(character.id)}.json`), memories[character.id] ?? []);
    }
    await atomicJson(join(dir, 'state.json'), data);
    // A single rename publishes history, tables and all character memories together.
    if (publish) await atomicJson(join(base, 'head.json'), { revision });
    return { ...data, revision, memories };
  }
  async sessions() {
    const files = await readdir(join(this.root, 'sessions'), { withFileTypes: true });
    const values = [];
    for (const file of files.filter(f => f.isDirectory())) {
      const head = await readJson(join(this.sessionDir(file.name), 'head.json'), null);
      if (!head) continue;
      const state = await readJson(join(this.sessionDir(file.name), 'revisions', safeId(head.revision), 'state.json'));
      values.push({ id: state.id, title: state.title, cardId: state.cardId, updatedAt: state.updatedAt, messageCount: state.messages.length });
    }
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async restore(id, revision) {
    const state = await this.session(id, revision);
    await atomicJson(join(this.sessionDir(id), 'head.json'), { revision: state.revision });
    return state;
  }
}
