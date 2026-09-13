import { staticText } from './prompt-context.js';
import { renderTemplates } from './templates.js';

// Preserve the imported template, but move its changing substitutions to named
// input values. Repeated placeholders reference one copy of the same value.
// Executable templates retain their original evaluation as one dynamic block.
export async function advanceMessages({ source, values, bookParts, replace, relay, env, tables, signal, timeout }) {
  // Do not change evaluation order when any template can execute code or carry
  // a condition across a substitution boundary.
  const executable = /<%|<if\b|\{\{\s*(?:set|add|inc|dec|delete|push|pop)/i;
  if (source.some(prompt => executable.test(replace(prompt.content, values, relay)))) {
    const rendered = await renderTemplates({ env, tables, texts: source.map(prompt => ({ text: replace(prompt.content, values, relay) })) }, { signal, timeout });
    return source.map((prompt, index) => ({ role: /^(ai|assistant)$/i.test(prompt.role) ? 'assistant' : String(prompt.role ?? 'user').toLowerCase(), content: rendered.texts[index],
      cacheStatic: staticText(prompt.content) && staticText(replace(prompt.content, values, relay)) && !/(?<!\\)\$[15678]\b|\{\{/.test(prompt.content),
    })).filter(message => message.content.trim());
  }
  const slots = new Map();
  const ref = (name, content, cacheStatic = false) => {
    slots.set(name, { content, cacheStatic });
    return `<tavern-context ref="${name}"/>`;
  };
  const texts = source.map(prompt => {
    const expanded = replace(prompt.content, values, relay);
    const role = /^(ai|assistant)$/i.test(prompt.role) ? 'assistant' : String(prompt.role ?? 'user').toLowerCase();
    const literal = prompt.content.replace(/(?<!\\)\$[15678]\b|\{\{[^{}]+\}\}/g, '');
    const macros = [...prompt.content.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]);
    const knownMacros = macros.every(name => Object.keys(relay).some(key => key.toLowerCase() === name.toLowerCase()) || /^(?:user|char|description|personality|scenario|persona)$/.test(name.trim()));
    if (!staticText(literal) || !knownMacros || /<%|\{\{\s*(?:set|add|inc|dec|delete|push|pop)/i.test(expanded)) return { role, content: expanded, cacheStatic: false };
    const substitutions = { ...values };
    for (const [token, name] of Object.entries({ '$1': 'worldbook', '$5': 'tables', '$6': 'previousAdvance', '$7': 'history', '$8': 'userInput', '$U': 'persona', '$C': 'card' })) {
      if (!new RegExp(`(?<!\\\\)\\${token}\\b`).test(prompt.content)) continue;
      if (token === '$1' && bookParts) {
        ref('worldbook_fixed', bookParts.fixed, true); ref('worldbook_active', bookParts.dynamic);
        substitutions[token] = '<tavern-context ref="worldbook_fixed,worldbook_active"/>';
      } else if (!['$U', '$C'].includes(token) || !staticText(values[token])) substitutions[token] = ref(name, replace(token, values, relay));
    }
    const references = Object.fromEntries(Object.entries(relay).map(([name, contents]) => [name, macros.some(m => m.toLowerCase() === name.toLowerCase()) ? [ref(`relay_${name}`, contents.join('\n\n'))] : contents]));
    return { role, content: replace(prompt.content, substitutions, references), cacheStatic: true };
  });
  const entries = [...slots];
  const rendered = await renderTemplates({ env, tables, texts: [...texts.map(message => ({ text: message.content })), ...entries.map(([, slot]) => ({ text: slot.content }))] }, { signal, timeout });
  const messages = texts.map((message, index) => ({ ...message, content: rendered.texts[index] })).filter(message => message.content.trim());
  for (const [index, [name, slot]] of entries.entries()) messages.push({ role: 'user', content: `<tavern-context name="${name}">\n${rendered.texts[texts.length + index]}\n</tavern-context>`, cacheStatic: slot.cacheStatic });
  if (slots.size) messages.push({ role: 'system', content: '预设中的 <tavern-context ref="名称"/> 引用 name 相同的 tavern-context 资料块，按引用位置理解原模板；逗号分隔的名称按顺序用空行连接非空资料。同名资料只提供一次。', cacheStatic: true });
  return messages;
}
