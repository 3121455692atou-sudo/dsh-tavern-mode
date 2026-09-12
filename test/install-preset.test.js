import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPreset } from '../src/install-preset.js';

test('fresh installation registers a portable preset and preserves existing customizations', async t => {
  const home = await mkdtemp(join(tmpdir(), 'tavern-install-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await installPreset(home);
  const file = join(home, '.agent-presets/tavern/agent.cordis.yml');
  assert.match(await readFile(file, 'utf8'), /name: dsh-tavern-mode\/agent/);
  await writeFile(file, 'custom preset');
  await installPreset(home);
  assert.equal(await readFile(file, 'utf8'), 'custom preset');
});
