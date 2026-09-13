// Real project macros/regex; EJS/SQL conditions and process sandbox are NOT
// simulated. Those require the declared production runtime.
import { macroEnvironment, expandMacros, applyRegex } from '../../src/macros.js';
export async function renderTemplates(input) {
  const env = macroEnvironment(input.env);
  const texts = input.texts.map(item => {
    let text = item.text ?? '';
    if ((item.ejs !== false && /<%/.test(text)) || (item.conditions !== false && /<if\b/i.test(text))) throw new Error('Executable template requires production sandbox verification');
    if (item.regexPhase) text = applyRegex(text, input.regexScripts, { env, phase: item.regexPhase, placement: item.placement, depth: item.depth, edit: item.edit });
    if (item.macros !== false) text = expandMacros(text, env);
    return text;
  });
  return { texts, variables: env.variables, globalVariables: env.globalVariables, diagnostics: env.diagnostics };
}
