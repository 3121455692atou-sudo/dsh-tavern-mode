import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frontendModules } from '../src/frontend-modules.js';
import { readJson, atomicJson } from '../src/storage.js';

test('Frontend modules preserve module URLs and share cached dependencies across scripts and server restarts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tavern-module-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let downloads = 0;
  const loader = frontendModules(directory, async () => { downloads++; return new Response("export { value } from './child.js'; export const text = 'https://example.com/literal';"); });
  const origin = 'http://127.0.0.1:1234', url = 'https://example.com/package/main.js';
  const script = await loader.compile(`import { value } from '${url}'; window.top.value = value;`, undefined, origin);
  assert.ok(script.includes(origin + '/module?url=' + encodeURIComponent(url))); assert.match(script, /__tavernHost\.value/);
  const [a, b] = await Promise.all([loader.load(url, origin), loader.load(url, origin)]);
  assert.equal(a, b); assert.equal(downloads, 1);
  assert.ok(a.includes(encodeURIComponent('https://example.com/package/child.js'))); assert.ok(a.includes('https://example.com/literal'));
  const restored = frontendModules(directory, async () => { throw new Error('offline'); });
  assert.equal(await restored.load(url, origin), a);
  const file = join(directory, (await readdir(directory))[0]);
  await atomicJson(file, { ...await readJson(file), fetchedAt: 0 });
  const refreshed = frontendModules(directory, async () => { downloads++; return new Response('export const value = 2;'); });
  assert.match(await refreshed.load(url, origin), /value = 2/); assert.equal(downloads, 2);
});
