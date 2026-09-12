import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, atomicJson } from './storage.js';

const modulePath = (url, origin) => origin + '/module?url=' + encodeURIComponent(url);

export function frontendModules(cacheDir, request = fetch) {
  const pending = new Map(), memory = new Map();
  async function compile(code, base, origin) {
    const result = await build({
      stdin: { contents: code, sourcefile: base ?? 'frontend.js' }, bundle: true, write: false, format: 'esm', target: 'es2022', charset: 'utf8', logLevel: 'silent',
      define: { 'window.top': '__tavernHost', 'globalThis.top': '__tavernHost', top: '__tavernHost' },
      plugins: [{ name: 'frontend-module-urls', setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          const url = /^https:\/\//.test(args.path) ? args.path : base && /^[./]/.test(args.path) ? new URL(args.path, base).href : undefined;
          return { path: url ? modulePath(url, origin) : /^[./]/.test(args.path) ? new URL(args.path, origin).href : args.path, external: true };
        });
      } }],
    });
    return result.outputFiles[0].text;
  }
  async function load(url, origin) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('前端模块必须使用 HTTPS');
    const file = cacheDir && join(cacheDir, createHash('sha256').update(url).digest('hex') + '.json');
    let cached = memory.get(url) ?? (file ? await readJson(file, null) : undefined);
    if (!cached || Date.now() - (cached.fetchedAt ?? 0) >= 86400000) {
      try {
        const response = await request(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`模块加载失败：HTTP ${response.status} ${url}`);
        cached = { url: response.url || url, source: await response.text(), fetchedAt: Date.now() };
        if (file) { await mkdir(cacheDir, { recursive: true }); await atomicJson(file, cached); }
      } catch (error) { if (!cached) throw error; }
    }
    memory.set(url, cached);
    return compile(cached.source, cached.url, origin);
  }
  return { compile, load(url, origin) {
    if (!pending.has(url)) pending.set(url, load(url, origin).finally(() => pending.delete(url)));
    return pending.get(url);
  } };
}
