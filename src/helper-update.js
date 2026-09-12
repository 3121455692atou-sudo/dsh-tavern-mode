import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import { buildHelper, helperFiles, helperHostFiles } from './helper-build.js';

export async function openHelper(project, dataDir, { fetch: request = fetch, compile = buildHelper } = {}) {
  const directory = join(dataDir, 'tavern-helper'), file = join(directory, 'status.json');
  await mkdir(directory, { recursive: true });
  const bundled = await readJson(join(project, 'vendor/tavern-helper/upstream.json'));
  const manifest = await readJson(join(project, 'vendor/tavern-helper/manifest.json'));
  const adapter = createHash('sha256').update(helperFiles.join('\0'));
  for (const path of helperHostFiles) adapter.update('\0' + path + '\0').update(await readFile(join(project, path)));
  const adapterHash = adapter.digest('hex');
  let state = await readJson(file, { version: manifest.version, commit: bundled.commit, autoUpdate: true, bundled: true });
  if (!state.bundled && state.adapterHash !== adapterHash) state = { ...state, bundled: true };
  if (state.bundled) state = { ...state, version: manifest.version, commit: bundled.commit };
  let pending, disposed = false;
  const abort = new AbortController();
  const persist = () => atomicJson(file, state);
  async function download(url) {
    const response = await request(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]) });
    if (!response.ok) throw new Error(`酒馆助手更新请求失败：HTTP ${response.status}`);
    return response;
  }
  async function update() {
    let staging;
    try {
      const { sha } = await (await download('https://api.github.com/repos/N0VI028/JS-Slash-Runner/commits/main')).json();
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('官方提交标识无效');
      if (sha !== state.commit) {
        staging = join(directory, sha);
        const files = {};
        const downloads = await Promise.allSettled(helperFiles.map(async path => {
          const bytes = Buffer.from(await (await download(`https://raw.githubusercontent.com/N0VI028/JS-Slash-Runner/${sha}/${path}`)).arrayBuffer());
          const target = join(staging, path);
          await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
          files[path] = createHash('sha256').update(bytes).digest('hex');
        }));
        const failure = downloads.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
        const next = await readJson(join(staging, 'manifest.json'));
        if (typeof next.version !== 'string') throw new Error('官方版本信息无效');
        await compile(staging, join(staging, 'runtime.js'));
        await atomicJson(join(staging, 'upstream.json'), { repository: bundled.repository, commit: sha, files });
        state = { ...state, version: next.version, commit: sha, adapterHash, bundled: false };
        staging = undefined;
      }
      state = { ...state, checkedAt: new Date().toISOString(), error: null };
      await persist(); return { ...state };
    } catch (error) {
      if (staging) await rm(staging, { recursive: true, force: true });
      if (!disposed) { state = { ...state, checkedAt: new Date().toISOString(), error: error.message }; await persist(); }
      throw error;
    }
  }
  return {
    status: () => ({ ...state, repository: bundled.repository }),
    bundle: () => state.bundled ? join(project, 'lib/tavern-helper.js') : join(directory, state.commit, 'runtime.js'),
    check() { pending ??= update().finally(() => { pending = undefined; }); return pending; },
    async configure(autoUpdate) { if (typeof autoUpdate !== 'boolean') throw new Error('自动更新设置无效'); state = { ...state, autoUpdate }; await persist(); return { ...state }; },
    start(changed) {
      const tick = async () => {
        if (!state.autoUpdate || Date.now() - Date.parse(state.checkedAt ?? '1970-01-01') < 86400000) return;
        const previous = state.commit;
        try { await this.check(); if (state.commit !== previous) changed(); } catch { /* Keep the last working runtime; status contains the update error. */ }
      };
      const initial = setTimeout(tick, 5000), timer = setInterval(tick, 3600000); initial.unref(); timer.unref();
      return () => { disposed = true; clearTimeout(initial); clearInterval(timer); abort.abort(); };
    },
  };
}
