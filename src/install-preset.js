import { copyFile, mkdir, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export async function installPreset(home = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  const target = join(home, '.agent-presets', 'tavern');
  await mkdir(target, { recursive: true });
  for (const name of ['agent.cordis.yml', 'preset.yml']) {
    try { await copyFile(fileURLToPath(new URL(`../presets/tavern/${name}`, import.meta.url)), join(target, name), constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
