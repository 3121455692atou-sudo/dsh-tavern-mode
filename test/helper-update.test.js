import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
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
