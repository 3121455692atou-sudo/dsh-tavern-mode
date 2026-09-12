import ejs from './template-compat/ejs.cjs';
import lodash from 'lodash';
import { queryFacade } from './db-query.js';
import { macroEnvironment, expandMacros, applyRegex } from './macros.js';
import { createWorldInfoReader } from './template-compat/worldinfo.js';

function conditions(text, db) {
  const root = { children: [] };
  const stack = [root];
  const tags = /<if\b(?:[^<>"']|"[^"]*"|'[^']*')*>|<\/if\s*>|<else\s*\/?\s*>/gi;
  let cursor = 0;
  for (const match of text.matchAll(tags)) {
    const tag = match[0];
    const opening = /^<if\b/i.test(tag);
    const attribute = opening && tag.match(/\bdb\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (opening ? !attribute : stack.length === 1) continue;
    const current = stack.at(-1);
    current.children.push(text.slice(cursor, match.index));
    if (opening) {
      const node = { expression: (attribute[1] ?? attribute[2]).replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'), children: [], alternative: [] };
      current.children.push(node);
      stack.push(node);
    } else if (/^<else/i.test(tag)) {
      if (current.isElse) throw new Error('条件块的 else 位置无效');
      current.then = current.children;
      current.children = current.alternative;
      current.isElse = true;
    } else {
      stack.pop();
    }
    cursor = match.index + tag.length;
  }
  stack.at(-1).children.push(text.slice(cursor));
  if (stack.length !== 1) throw new Error('条件块缺少结束标签');
  const render = nodes => nodes.map(node => {
    if (typeof node === 'string') return node;
    let value = false;
    try { value = new Function('db', `"use strict"; return (${node.expression});`)(db); }
    catch { value = false; }
    return render(value ? (node.then ?? node.children) : node.alternative);
  }).join('');
  return render(root.children);
}

export async function renderBatch(input) {
  const env = macroEnvironment(input.env);
  const db = queryFacade(input.tables ?? []);
  const scope = options => options?.scope === 'global' || options?.type === 'global' ? env.globalVariables : env.variables;
  const context = {
    _: lodash, db, variables: env.variables, user: env.user, char: env.char,
    world_info: env.world_info,
    getvar: (key, options) => lodash.get(scope(options), key, options?.defaults),
    setvar: (key, value, options) => { lodash.set(scope(options), key, value); return ''; },
    getglobalvar: (key, options) => lodash.get(env.globalVariables, key, options?.defaults),
    setglobalvar: (key, value) => { lodash.set(env.globalVariables, key, value); return ''; },
    incvar: (key, amount = 1, options) => { const target = scope(options); const value = Number(lodash.get(target, key, 0)) + Number(amount); lodash.set(target, key, value); return value; },
    getVariables: options => structuredClone(scope(options)),
    replaceVariables: (value, options) => { const target = scope(options); for (const key of Object.keys(target)) delete target[key]; Object.assign(target, value); },
    getChatMessages: () => env.messages.map((m, message_id) => ({ message_id, role: m.role, message: m.content, name: m.name })),
    getchar: () => env.card ?? {},
  };
  const renderEjs = async (text, data) => {
    if (!text.includes('<%')) return text;
    try {
      const template = ejs.compile(text, { async: true, outputFunctionName: 'print', _with: true, localsName: 'locals', client: true, rmWhitespace: false });
      return await template.call(data, data, ejs.escapeXML, (name, params) => data.getwi(name, params));
    } catch (error) {
      if (error.name === 'SyntaxError' || /token|Unexpected|matching close tag/i.test(error.message)) {
        env.diagnostics.push(`EJS 未执行：${error.message.split('\n')[0]}`);
        return text;
      }
      throw error;
    }
  };
  context.getwi = createWorldInfoReader({
    context, _: lodash, chat: env.messages, this_chid: 0,
    characters: [{ data: { extensions: { world: env.charLoreBook || env.card?.extensions?.world || env.card?.character_book?.name || (env.card?.character_book ? env.card.name : '') } } }],
    power_user: { persona_description_lorebook: env.userLoreBook },
    chat_metadata: { ...env.chatMetadata, ...(env.chatLoreBook ? { world_info: env.chatLoreBook } : {}) },
    loadWorldInfo: async name => {
      const entries = (env.worldbook ?? []).filter(entry => entry.world === name).map(entry => ({ ...entry,
        uid: entry.originalId ?? entry.uid ?? entry.id, comment: entry.comment ?? entry.name ?? '',
        order: entry.insertion_order ?? entry.order ?? 100, position: entry.extensions?.position ?? entry.position ?? 0, depth: entry.extensions?.depth ?? entry.depth,
      }));
      return entries.length ? { entries } : null;
    },
    evalTemplate: renderEjs, substituteParams: text => expandMacros(text, env),
    getRegexedString: (text, placement) => applyRegex(text, input.regexScripts, { env, phase: 'source', placement }),
  });
  const texts = [];
  for (const item of input.texts) {
    let text = item.text ?? '';
    if (item.regexPhase) text = applyRegex(text, input.regexScripts, { env, phase: item.regexPhase, placement: item.placement, depth: item.depth, edit: item.edit });
    if (item.conditions !== false) text = conditions(text, db);
    if (item.macros !== false) text = expandMacros(text, env);
    if (item.ejs !== false && text.includes('<%')) {
      text = await renderEjs(text, context);
    }
    texts.push(text);
  }
  return { texts, variables: env.variables, globalVariables: env.globalVariables, diagnostics: env.diagnostics };
}

if (process.argv[1]?.endsWith('/template-worker.js')) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const logs = [];
  console.log = console.warn = console.info = (...args) => { if (logs.length < 20) logs.push(args.map(String).join(' ').slice(0, 500)); };
  try {
    const output = await renderBatch(JSON.parse(input));
    output.diagnostics.push(...logs);
    process.stdout.write(JSON.stringify(output));
  } catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
