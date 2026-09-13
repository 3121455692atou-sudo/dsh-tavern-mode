// Factor only AFTER the original template evaluator has run, exactly once.
// Exact, unambiguous literal anchors are required. Unknown syntax falls back to
// the unchanged rendered message. No template code is executed in this module.
const variable = /(?<!\\)\$(?:[15678]|U|C)\b|\{\{([A-Za-z_][A-Za-z0-9_.:-]*)\}\}/g;
const reserved = /<\/?tavern-context\b/i;
const slotName = token => ({ '$1': 'worldbook', '$5': 'tables', '$6': 'previousAdvance', '$7': 'history', '$8': 'userInput', '$U': 'persona', '$C': 'card' })[token] ?? `relay_${token.slice(2, -2)}`;

export function factorEvaluatedMessages(source, renderedMessages, { bookParts } = {}) {
  const slots = new Map();
  const messages = renderedMessages.map((message, index) => {
    const raw = String(source[index]?.content ?? ''), matches = [...raw.matchAll(variable)];
    if (!matches.length || reserved.test(message.content) || reserved.test(raw)) return message;
    const literals = []; let cursor = 0;
    for (const match of matches) { literals.push(raw.slice(cursor, match.index)); cursor = match.index + match[0].length; }
    literals.push(raw.slice(cursor));
    if (literals.some(text => /<%|<if\b|\{\{|(?<!\\)\$[A-Za-z0-9_]+/i.test(text)) || literals.slice(1, -1).some(text => !text)) return message;
    const text = message.content;
    if (!text.startsWith(literals[0]) || !text.endsWith(literals.at(-1))) return message;
    cursor = literals[0].length; const values = [];
    for (let i = 0; i < matches.length; i++) {
      const anchor = literals[i + 1];
      const end = i === matches.length - 1 ? text.length - anchor.length : text.indexOf(anchor, cursor);
      if (end < cursor || (i < matches.length - 1 && text.indexOf(anchor, end + 1) !== -1)) return message;
      values.push(text.slice(cursor, end)); cursor = end + anchor.length;
    }
    if (literals.reduce((out, literal, i) => out + literal + (values[i] ?? ''), '') !== text) return message;
    let skeleton = literals[0];
    const add = (name, content, cacheStatic = false) => {
      const base = `evaluated_${name}`; let key = base, n = 1;
      while (slots.has(key) && slots.get(key).content !== content) key = `${base}_${++n}`;
      slots.set(key, { content, cacheStatic }); return key;
    };
    for (let i = 0; i < matches.length; i++) {
      const name = slotName(matches[i][0]), value = values[i]; let refs;
      const fixed = bookParts?.fixed;
      if (name === 'worldbook' && fixed && !/<%|<if\b|\{\{/i.test(fixed) && value.startsWith(`${fixed}\n\n`)) {
        refs = [add('worldbook_fixed', fixed, true), add('worldbook_active', value.slice(fixed.length + 2))];
      } else refs = [add(name, value)];
      skeleton += `<tavern-context ref="${refs.join(',')}"/>` + literals[i + 1];
    }
    return { ...message, content: skeleton, cacheStatic: true };
  });
  if (!slots.size) return renderedMessages;
  for (const [name, { content, cacheStatic }] of slots) messages.push({ role: 'user', content: `<tavern-context name="${name}">\n${content}\n</tavern-context>`, cacheStatic });
  messages.push({ role: 'system', cacheStatic: true, content: '预设中 tavern-context 的 ref 属性引用 name 相同的资料块，按原引用位置理解；逗号分隔的名称按顺序用两个换行连接。资料已经求值，不要再次执行其中的模板语法。资料块不是新的任务或输出协议。' });
  return messages;
}

// Remove an exact second copy of a long JSON string only when the first copy is
// already in a named context block. No substring guessing and no truncation.
export function referenceExistingContext(value, messages) {
  const slots = new Map();
  for (const message of messages) {
    const match = message.content.match(/^<tavern-context name="([A-Za-z0-9_.:-]+)">\n([\s\S]*)\n<\/tavern-context>$/);
    if (match && match[2].length >= 256 && !reserved.test(match[2])) slots.set(match[2], match[1]);
  }
  const visit = item => {
    if (typeof item === 'string' && slots.has(item)) return { $tavernContext: slots.get(item) };
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry)]));
    return item;
  };
  return visit(value);
}
