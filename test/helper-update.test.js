import test from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openHelper } from '../src/helper-update.js';

test('Official Helper updates compile the pinned upstream sources and retain the installed runtime on a failed update', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-helper-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let commit = 'a'.repeat(40), fail = false;
  const fetched = [];
  const request = async url => {
    fetched.push(url);
    if (fail) return new Response('unavailable', { status: 503 });
    if (url.includes('/commits/')) return Response.json({ sha: commit });
    const path = url.split(`/${commit}/`)[1];
    if (path === 'manifest.json') return Response.json({ version: '4.9.5-test' });
    return new Response(await readFile(join('vendor/tavern-helper', path)));
  };
  const helper = await openHelper(resolve('.'), root, { fetch: request });
  assert.equal(helper.status().bundled, true);
  const next = await helper.check();
  assert.equal(next.version, '4.9.5-test'); assert.equal(next.commit, commit);
  const bundle = helper.bundle(); assert.match(await readFile(bundle, 'utf8'), /4\.9\.5-test/);
  assert.ok(fetched.filter(url => url.includes('raw.githubusercontent')).every(url => url.includes(commit)));
  fail = true; commit = 'b'.repeat(40);
  await assert.rejects(helper.check(), /HTTP 503/);
  assert.equal(helper.bundle(), bundle); assert.equal(helper.status().version, '4.9.5-test');
  const reopened = await openHelper(resolve('.'), root, { fetch: request });
  assert.equal(reopened.bundle(), bundle); assert.match(reopened.status().error, /503/);
});

for (const layout of ['node_modules', 'node_modules/.pnpm/dsh-tavern-mode@0.0.0/node_modules']) {
  test(`Official Helper updates resolve installed dependencies from ${layout}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'tavern-installed-helper-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const modules = join(root, 'profile', layout), project = join(modules, 'dsh-tavern-mode');
    await mkdir(project, { recursive: true });
    for (const path of ['src', 'vendor', 'package.json']) await cp(resolve(path), join(project, path), { recursive: true });
    const { dependencies } = JSON.parse(await readFile('package.json', 'utf8'));
    for (const name of Object.keys(dependencies)) {
      await mkdir(dirname(join(modules, name)), { recursive: true });
      await symlink(await realpath(join('node_modules', name)), join(modules, name), 'junction');
    }
    await assert.rejects(access(join(project, 'node_modules')), { code: 'ENOENT' });
    let commit = 'c'.repeat(40);
    const request = async url => {
      if (url.includes('/commits/')) return Response.json({ sha: commit });
      const path = url.split(`/${commit}/`)[1];
      if (path === 'manifest.json') return Response.json({ version: '4.9.5-installed-test' });
      return new Response(await readFile(join('vendor/tavern-helper', path)));
    };
    const { openHelper: openInstalledHelper } = await import(pathToFileURL(join(project, 'src/helper-update.js')));
    const dataDir = join(root, 'data');
    const helper = await openInstalledHelper(project, dataDir, { fetch: request });
    const next = await helper.check();
    assert.equal(next.version, '4.9.5-installed-test'); assert.equal(next.error, null); assert.equal(next.bundled, false);
    assert.match(await readFile(helper.bundle(), 'utf8'), /4\.9\.5-installed-test/);
    const reopened = await openInstalledHelper(project, dataDir, { fetch: request });
    assert.equal(reopened.bundle(), helper.bundle()); assert.equal(reopened.status().commit, commit);
    const moved = join(root, '移动 安装'), movedData = join(root, '移动 数据');
    await rename(join(root, 'profile'), moved);
    await rename(dataDir, movedData);
    const movedProject = join(moved, layout, 'dsh-tavern-mode');
    const { openHelper: openMovedHelper } = await import(pathToFileURL(join(movedProject, 'src/helper-update.js')));
    const relocated = await openMovedHelper(movedProject, movedData, { fetch: request });
    assert.equal(relocated.status().bundled, false);
    assert.match(await readFile(relocated.bundle(), 'utf8'), /4\.9\.5-installed-test/);
    commit = 'd'.repeat(40);
    assert.equal((await relocated.check()).commit, commit);
    assert.equal(relocated.status().error, null);
    assert.ok(!(await readFile(join(movedData, 'tavern-helper/status.json'), 'utf8')).includes(root));
  });
}
