export const sourcePassages = input => input.sourcePassages.flatMap(({ messageId, passages }) => passages.map(passage => ({ ...passage, messageId })));

// Assertions about imported preset semantics resolve model-facing references;
// cache-order assertions inspect the original, unexpanded messages instead.
export function expandedMessages(messages = []) {
  const values = Object.fromEntries(messages.flatMap(message => {
    const match = message.content.match(/^<tavern-context name="([^"]+)">\n([\s\S]*)\n<\/tavern-context>$/);
    return match ? [[match[1], match[2]]] : [];
  }));
  return messages.map(message => ({ ...message, content: message.content.replace(/<tavern-context ref="([^"]+)"\/>/g,
    (match, names) => names.split(',').every(name => Object.hasOwn(values, name)) ? names.split(',').map(name => values[name]).filter(Boolean).join('\n\n') : match) }));
}
