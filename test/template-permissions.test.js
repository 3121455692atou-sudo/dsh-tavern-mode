import test from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

for (const layout of ['hoisted', 'pnpm']) {
  test(`template permissions resolve ${layout} dependencies without exposing profile data`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'tavern-template-permissions-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const profile = join(root, 'profile with spaces');
    const modules = layout === 'hoisted'
      ? join(profile, 'node_modules')
      : join(profile, 'node_modules/.pnpm/dsh-tavern-mode@0.0.0/node_modules');
    const installed = join(modules, 'dsh-tavern-mode');
    await mkdir(installed, { recursive: true });
    await cp(join(project, 'src'), join(installed, 'src'), { recursive: true });
    await cp(join(project, 'package.json'), join(installed, 'package.json'));
    for (const name of ['lodash', 'yaml']) {
      const dependency = dirname(require.resolve(`${name}/package.json`));
      if (layout === 'hoisted') await cp(dependency, join(modules, name), { recursive: true });
      else await symlink(dependency, join(modules, name), 'junction');
    }
    await assert.rejects(access(join(installed, 'node_modules')), { code: 'ENOENT' });
    const { renderTemplates } = await import(pathToFileURL(join(installed, 'src/templates.js')));
    const result = await renderTemplates({
      env: { user: 'Reader', variables: { profile: { level: 7 }, count: 2 } },
      texts: [
        { text: '{{user}}:<%= _.sum([1, 2, 3]) %>' },
        { text: '{{format_chat_variable::profile}}' },
        { text: '<% setvar("count", getvar("count") + 3) %><%= getvar("count") %>' },
        { text: '<%= process.permission.has("fs.write") %>|<%= process.permission.has("child") %>|<%= process.permission.has("net") %>' },
      ],
    });
    assert.deepEqual(result.texts, ['Reader:6', 'level: 7', '5', 'false|false|false']);
    assert.equal(result.variables.count, 5);
    assert.deepEqual(result.diagnostics, []);

    const privateFile = join(profile, 'private-data.txt');
    const unrelatedFile = join(modules, 'unrelated-package/private-data.txt');
    await mkdir(dirname(unrelatedFile), { recursive: true });
    for (const path of [privateFile, unrelatedFile]) {
      await writeFile(path, 'must remain outside the template read allowlist');
      await assert.rejects(renderTemplates({ texts: [{
        text: `<%= process.getBuiltinModule('fs').readFileSync(${JSON.stringify(path)}, 'utf8') %>`,
      }] }), /Access to this API has been restricted/);
      assert.equal(await readFile(path, 'utf8'), 'must remain outside the template read allowlist');
    }
  });
}
