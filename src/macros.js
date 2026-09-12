import get from 'lodash/get.js';
import unescape from 'lodash/unescape.js';
import { stringify as yamlStringify } from 'yaml';
import { pickMacro } from './template-compat/pick.js';
import { regexDispatch } from './template-compat/regex.js';

export function allRegex(card, preset, extras = [], order = [0, 2, 1]) {
  const groups = [extras, card.extensions?.regex_scripts ?? [], preset?.extensions?.regex_scripts ?? []];
  if (order.length !== 3 || new Set(order).size !== 3 || order.some(index => ![0, 1, 2].includes(index))) throw new Error('正则执行顺序无效');
  return order.flatMap(index => groups[index]);
}

export function macroEnvironment(input = {}) {
  return { variables: {}, globalVariables: {}, messages: [], user: '你', char: '', now: new Date().toISOString(), diagnostics: [], ...input };
}

function stored(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function variableValue(env, scope, path) {
  let variables = scope === 'chat' ? env.variables : env[scope + 'Variables'];
  if (scope === 'message') {
    const index = env.messageId ?? Object.keys(env.messageVariables ?? {}).map(Number).sort((a, b) => b - a).find(index => env.messageVariables[index] !== undefined);
    variables = env.messageVariables?.[index];
    if (Array.isArray(variables)) variables = variables[env.messageSwipes?.[index] ?? 0];
  }
  const withoutMetadata = value => Array.isArray(value) ? value.map(withoutMetadata) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$')).map(([key, entry]) => [key, withoutMetadata(entry)])) : value;
  return withoutMetadata(get(variables, unescape(path), null));
}

export function expandMacros(source, env, transform = value => value) {
  const pick = pickMacro(String(source ?? ''), env);
  let result = String(source ?? '').replace(/\s*\{\{trim\}\}\s*/gi, '');
  // These braces are Tavern's declared macro grammar, never a prose extractor.
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    result = result.replace(/\{\{([^{}]*?)\}\}/g, (whole, body, offset) => {
      if (whole.match(pick.regex)) return whole;
      const pieces = body.split('::');
      const name = pieces.shift().trim().toLowerCase();
      const [key, ...tail] = pieces;
      const value = tail.join('::');
      let replacement;
      if (name.startsWith('//')) replacement = '';
      else if (/^(get|format)_(message|chat|character|preset|global)_variable$/.test(name)) {
        const [kind, scope] = name.split('_');
        const variable = variableValue(env, scope, pieces.join('::'));
        replacement = typeof variable === 'string' ? variable : kind === 'format' ? yamlStringify(variable, { blockQuote: 'literal' }).trimEnd() : JSON.stringify(variable);
        if (kind === 'format') replacement = replacement.replaceAll('\n', '\n' + ' '.repeat(offset - result.lastIndexOf('\n', offset - 1) - 1));
      }
      else if (name === 'setvar' || name === 'setglobalvar') { (name === 'setvar' ? env.variables : env.globalVariables)[key] = value; replacement = ''; }
      else if (name === 'getvar' || name === 'getglobalvar') replacement = stored((name === 'getvar' ? env.variables : env.globalVariables)[key]);
      else if (['addvar', 'incvar', 'decvar', 'addglobalvar', 'incglobalvar', 'decglobalvar'].includes(name)) {
        const target = name.includes('global') ? env.globalVariables : env.variables;
        const add = name.startsWith('inc') ? 1 : name.startsWith('dec') ? -1 : value;
        target[key] = Number.isFinite(Number(target[key] ?? 0)) && Number.isFinite(Number(add)) ? Number(target[key] ?? 0) + Number(add) : stored(target[key]) + stored(add);
        replacement = name.startsWith('add') ? '' : stored(target[key]);
      } else if (name === 'unsetvar' || name === 'unsetglobalvar') { delete (name === 'unsetvar' ? env.variables : env.globalVariables)[key]; replacement = ''; }
      else if (name === 'hasvar' || name === 'hasglobalvar') replacement = String(Object.hasOwn(name === 'hasvar' ? env.variables : env.globalVariables, key));
      else if (name === 'random') replacement = pieces[Math.floor((env.random ?? Math.random)() * pieces.length)] ?? '';
      else if (/^roll\s+\d*d\d+(?:[+-]\d+)?$/.test(name)) {
        const [, n, sides, plus] = name.match(/^roll\s+(\d*)d(\d+)([+-]\d+)?$/);
        if (Number(n || 1) > 10000 || Number(sides) < 1) throw new Error('掷骰宏参数超出范围');
        replacement = String(Array.from({ length: Number(n || 1) }, () => 1 + Math.floor((env.random ?? Math.random)() * Number(sides))).reduce((a, b) => a + b, Number(plus || 0)));
      } else {
        const messages = env.messages;
        const values = {
          user: env.user, char: env.char, persona: env.persona ?? '', description: env.description ?? '', personality: env.personality ?? '', scenario: env.scenario ?? '',
          group: env.group ?? env.char,
          lastusermessage: messages.findLast(m => m.role === 'user')?.content ?? '',
          lastcharmessage: messages.findLast(m => m.role === 'assistant')?.content ?? '',
          lastmessage: messages.at(-1)?.content ?? '', lastmessageid: String(Math.max(0, messages.length - 1)),
          chatid: env.sessionId ?? '', date: new Date(env.now).toLocaleDateString('zh-CN'),
          time: new Date(env.now).toLocaleTimeString('zh-CN', { hour12: false }), weekday: new Date(env.now).toLocaleDateString('zh-CN', { weekday: 'long' }),
          isodate: env.now.slice(0, 10), isotime: env.now.slice(11, 19), newline: '\n', noop: '', input: env.input ?? '',
        };
        if (Object.hasOwn(values, name)) replacement = stored(values[name]);
        else if (Object.hasOwn(env.customMacros ?? {}, name)) replacement = stored(env.customMacros[name]);
        else { if (!env.diagnostics.includes(`未识别宏：${name}`)) env.diagnostics.push(`未识别宏：${name}`); return whole; }
      }
      const output = transform(replacement);
      if (output !== whole) changed = true;
      return output;
    });
    const picked = result.replace(pick.regex, (...args) => transform(pick.replace(...args)));
    if (picked !== result) changed = true;
    result = picked;
    if (!changed) return result;
  }
  throw new Error('宏展开超过 40 层，检查循环引用');
}

export function parseRegex(source) {
  if (typeof source !== 'string' || !source) throw new Error('正则表达式为空');
  if (source.startsWith('/')) {
    const slash = source.lastIndexOf('/');
    if (slash > 0) return new RegExp(source.slice(1, slash), source.slice(slash + 1));
  }
  return new RegExp(source);
}

export function applyRegex(text, scripts, { placement = 2, phase = 'display', depth, edit = false, env = macroEnvironment() } = {}) {
  return regexDispatch(text, (scripts ?? []).filter(script => script.placement?.includes(placement)), placement, { isMarkdown: phase === 'display', isPrompt: phase === 'prompt', isEdit: edit, depth }, (script, text) => {
    if (script.disabled || !script.findRegex) return text;
    let pattern = script.findRegex;
    if (Number(script.substituteRegex) === 1) pattern = expandMacros(pattern, env);
    if (Number(script.substituteRegex) === 2) pattern = expandMacros(pattern, env, value => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replaceAll('\n', '\\n'));
    let regex;
    try { regex = parseRegex(pattern); }
    catch (error) { throw new Error(`正则 ${script.scriptName ?? script.id} 无效：${error.message}`); }
    return text.replace(regex, (...args) => {
      const groups = typeof args.at(-1) === 'object' ? args.at(-1) : {};
      const count = args.length - (typeof args.at(-1) === 'object' ? 3 : 2);
      let replacement = String(script.replaceString ?? '').replace(/\{\{match\}\}/gi, '$0');
      replacement = replacement.replace(/\$(\d+)|\$<([^>]+)>/g, (_, number, name) => {
        let value = number !== undefined ? Number(number) < count ? args[Number(number)] ?? '' : '' : groups[name] ?? '';
        for (const trim of script.trimStrings ?? []) value = String(value).replaceAll(expandMacros(trim, env), '');
        return value;
      });
      return expandMacros(replacement, env);
    });
  });
}
