// Model-facing views keep story facts; the complete audit records stay in storage.
export const factView = ({ id, subject, key, value, op }, ids = false) => ({ ...(ids ? { id } : {}), ...(op === 'remove' ? { op } : {}), subject, key, value });
export const episodeView = (record, ids = false) => ({
  ...(ids ? { id: record.id } : {}),
  ...Object.fromEntries(['scene', 'summary', 'facts', 'relationships', 'openThreads'].filter(key => record[key] !== undefined).map(key => [key, record[key]])),
  ...(record.stateChanges?.length ? { stateChanges: record.stateChanges.map(change => factView(change)) } : {}),
});
export const recallView = recall => ({ characterId: recall.characterId, characterName: recall.characterName, perspective: recall.perspective ?? '',
  records: (recall.records ?? []).map(record => episodeView(record)), currentState: (recall.currentState ?? []).map(fact => factView(fact)) });

export function staticText(text = '') {
  return !/<%|<if\b|\{\{(?!\s*(?:user|char|description|personality|scenario|persona)\s*\}\})/i.test(text);
}
export function staticEntry(entry) {
  const x = entry.extensions ?? {};
  return entry.constant && entry.cacheStatic !== false && staticText(entry.content) && !x.group && !x.delay && !x.cooldown && !x.sticky && !x.triggers?.length && (x.useProbability === false || Number(x.probability ?? 100) === 100);
}
export function stableFirst(entries) {
  return [...entries.filter(staticEntry), ...entries.filter(entry => !staticEntry(entry))];
}

// Local estimate: word pieces plus Unicode characters. Framing is counted per message.
function textTokens(text) {
  let count = 0;
  for (const [part] of text.matchAll(/[A-Za-z0-9_]+|[^A-Za-z0-9_]/gu)) count += part.length > 1 && /^[A-Za-z0-9_]/.test(part) ? Math.ceil(part.length / 3) : 1;
  return count;
}
export const inputTokens = messages => 3 + messages.reduce((sum, message) => sum + 4 + textTokens(message.content), 0);
export function trimHistory(messages, limit) {
  const result = messages.map(message => ({ ...message }));
  let total = inputTokens(result);
  for (let index = 0; total > limit && index < result.length;) {
    if (!result[index].history) { index++; continue; }
    const message = result[index], points = [...message.content];
    const without = total - 4 - textTokens(message.content);
    if (without + 4 >= limit) { result.splice(index, 1); total = without; continue; }
    let low = 0, high = points.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (without + 4 + textTokens(points.slice(mid).join('')) > limit) low = mid + 1; else high = mid;
    }
    message.content = points.slice(low).join('');
    total = without + (message.content ? 4 + textTokens(message.content) : 0);
    if (!message.content) result.splice(index, 1); else index++;
  }
  if (total > limit) throw new Error('固定提示词与本轮输入超过最大输入，请调高最大输入或精简预设');
  return result;
}
