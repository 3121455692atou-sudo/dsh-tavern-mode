import { staticEntry, staticText } from './prompt-context.js';

// Tool views omit editor metadata and duplicate serializations; writer prompts
// continue to use the original worldbook entries and advance results.
export const worldbookTitle = entry => String(entry.comment ?? entry.title ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
export const worldbookDirectory = entries => entries.map(entry => ({ id: entry.id, title: worldbookTitle(entry), keys: entry.keys }));

export function orderedToolInput(input) {
  // Activated books and directories can change on every turn. Never let them
  // interrupt the prefix shared by templates, permanent canon and identities.
  const fixed = ['task', 'templates', 'staticWorldbook', 'card', 'characters', 'character', 'maximumRecallCount'];
  return Object.fromEntries([...fixed.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]), ...Object.entries(input).filter(([key]) => !fixed.includes(key))]);
}

export const orderedToolMessages = messages => {
  const fixed = message => message.cacheStatic === true;
  return [...messages.filter(fixed), ...messages.filter(message => !fixed(message))].map(({ role, content }) => ({ role, content }));
};

export function toolWorldbook(entries, key = 'worldbook') {
  const view = entry => ({ id: entry.id, title: worldbookTitle(entry), content: entry.content });
  return { staticWorldbook: entries.filter(staticEntry).map(view), [key]: entries.filter(entry => !staticEntry(entry)).map(view) };
}

export const tableTemplateView = ({ id, name, sqlName, keyColumn, headers, columns, instructions, updateConfig }) => ({
  id, name, sqlName, keyColumn, headers,
  columns: columns.map(({ cid, ...column }) => column), instructions, updateConfig,
});

// Keep the full quotes and evidence ids; send each message UUID only once.
export function evidenceSourceView(sources) {
  const groups = new Map();
  for (const { id, messageId, quote } of sources) {
    if (!groups.has(messageId)) groups.set(messageId, { messageId, passages: [] });
    groups.get(messageId).passages.push({ id, quote });
  }
  return [...groups.values()];
}

export const fixedToolMessages = messages => messages.map(message => ({ ...message,
  cacheStatic: message.cacheStatic !== false && staticText(message.content),
}));

export const advanceResultView = result => ({ taskName: result.taskName,
  ...(Object.keys(result.sections ?? {}).length ? { sections: result.sections } : { content: result.content }),
  ...(result.selectedRecords ? { selectedRecords: result.selectedRecords } : {}),
});
