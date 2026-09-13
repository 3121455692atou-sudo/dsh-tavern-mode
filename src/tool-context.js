// Tool views omit editor metadata and duplicate serializations; writer prompts
// continue to use the original worldbook entries and advance results.
export const worldbookTitle = entry => String(entry.comment ?? entry.title ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
export const worldbookDirectory = entries => entries.map(entry => ({ id: entry.id, title: worldbookTitle(entry), keys: entry.keys }));

export function orderedToolInput(input) {
  const fixed = ['templates', 'worldbook', 'activeWorldbook', 'worldbookDirectory', 'characters', 'character'];
  return Object.fromEntries([...fixed.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]), ...Object.entries(input).filter(([key]) => !fixed.includes(key))]);
}

export const advanceResultView = result => ({ taskName: result.taskName,
  ...(Object.keys(result.sections ?? {}).length ? { sections: result.sections } : { content: result.content }),
  ...(result.selectedRecords ? { selectedRecords: result.selectedRecords } : {}),
});
