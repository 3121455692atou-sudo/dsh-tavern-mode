import { resolve as base } from './loader.mjs';
export async function resolve(specifier, context, nextResolve) {
  const boundary = specifier.endsWith('/templates.js') ? 'templates.mjs' : specifier.endsWith('/tables.js') ? 'tables.mjs'
    : specifier === 'lodash/get.js' ? 'get.mjs' : specifier === 'lodash/unescape.js' ? 'unescape.mjs' : specifier === 'yaml' ? 'yaml.mjs' : null;
  if (boundary) return { url: new URL(boundary, import.meta.url).href, shortCircuit: true };
  return base(specifier, context, nextResolve);
}
