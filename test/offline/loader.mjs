// Explicit offline-only test boundary. NEVER imported by production code.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-llm') return { url: new URL('./sdk.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier === 'ajv') return { url: new URL('./schema.mjs', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
