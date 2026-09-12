import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importPath, importLegacyPrompts } from '../src/imports.js';
import { Store } from '../src/storage.js';

test('Local imports use the data directory and remain portable when it moves', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-import-paths-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = new Store(join(root, 'data'));
  await store.init();
  const source = join(root, '导入 文件');
  await mkdir(join(source, 'data/default-user'), { recursive: true });
  const book = { entries: { 0: { content: 'The library opens at nine.' } } };
  await writeFile(join(source, 'book.json'), JSON.stringify(book));
  await writeFile(join(source, 'data/default-user/settings.json'), JSON.stringify({
    extension_settings: { __userscripts: { fixture: { settings: JSON.stringify({ charCardPrompt: 'Describe the current scene.' }) } } },
  }));
  const [item] = await importPath(store, '../导入 文件/book.json');
  assert.deepEqual((await store.item(item.id)).data, book);
  const [legacy] = await importLegacyPrompts(store, '../导入 文件');
  assert.equal((await store.item(legacy.id)).data.charCardPrompt, 'Describe the current scene.');
  const moved = join(root, '移动 数据');
  await rename(store.root, moved);
  store = new Store(moved);
  assert.deepEqual((await store.item(item.id)).data, book);
  assert.ok(!(await readFile(join(moved, 'library', `${item.id}.json`), 'utf8')).includes(root));
  const [importedAgain] = await importPath(store, '../导入 文件/book.json');
  assert.deepEqual((await store.item(importedAgain.id)).data, book);
});
