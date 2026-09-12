import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
export const helperFiles = ['manifest.json', 'LICENSE', ...['preset', 'tavern_regex', 'event', 'global', 'util', 'version', 'lorebook_entry', 'worldbook'].map(name => `src/function/${name}.ts`), 'src/util/algorithm.ts', 'src/util/compatibility.ts'];
export const helperHostFiles = ['src/helper-entry.js', 'src/helper-host.js', 'src/helper-build.js', 'vendor/tavern-helper/host/world-info.js'];
const hostModules = new Set(['@/util/tavern', '@/function/extension', '@/function/script', '@/function/displayed_message', '@/function/macro_like', '@/function/raw_character', '@/function/lorebook']);

export async function buildHelper(source, outfile) {
  return build({
    entryPoints: [join(project, 'src/helper-entry.js')], outfile, bundle: true, metafile: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent', nodePaths: [join(project, 'node_modules')],
    plugins: [{ name: 'dsh-tavern-helper-host', setup(build) {
      build.onResolve({ filter: /^(@\/|@sillytavern\/)/ }, args => {
        if (hostModules.has(args.path) || args.path.startsWith('@sillytavern/')) return { path: join(project, 'src/helper-host.js') };
        return { path: join(source, args.path.replace(/^@\//, 'src/')) + (args.path.endsWith('.json') ? '' : '.ts') };
      });
    } }],
  });
}
