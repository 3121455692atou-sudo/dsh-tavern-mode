import { defaultWritingPreset } from './presets.js';

const manualSelection = options => (options.plotWorldbookConfig?.source || options.worldbookSource || 'character') === 'manual'
  ? options.plotWorldbookConfig?.manualSelection || options.selectedWorldbooks || [] : null;

export function selectAdvanceWorldbooks(directory, options) {
  if (options.worldbookEnabled === false) return [];
  const selection = manualSelection(options);
  if (selection === null) return directory.filter(book => book.source === 'character');
  if (!Array.isArray(selection) || selection.some(reference => typeof reference !== 'string' || !reference)) throw new Error('推进世界书 manualSelection / selectedWorldbooks 必须为资源名称或持久 ID 的数组');
  return [...new Set(selection.map(reference => {
    const byId = directory.filter(book => book.id === reference);
    const matches = byId.length ? byId : directory.filter(book => book.name === reference);
    if (!matches.length) throw new Error(`推进世界书「${reference}」未找到，请导入该世界书，或将手动选择改为已导入资源的名称或持久 ID`);
    if (matches.length > 1) throw new Error(`推进世界书「${reference}」存在同名资源，请将手动选择改为其中一个持久 ID：${matches.map(book => book.id).join('、')}`);
    return matches[0];
  }))];
}

export async function sessionAssets(store, state) {
  const cardItem = await store.item(state.cardId);
  const optional = async (id, kind) => { if (!id) return null; const item = await store.item(id); if (item.kind !== kind) throw new Error(`所选资源不是 ${kind}`); return item; };
  const extraPresetIds = [...new Set([state.toolPresetId, ...Object.values(state.config?.agents ?? {}).map(agent => agent.presetId)].filter(id => id && id !== state.presetId))];
  const [presetItem, extraPresetItems, legacyItem, bubbleItem, extraBooks, extraRegex] = await Promise.all([
    optional(state.presetId, 'preset'), Promise.all(extraPresetIds.map(id => optional(id, 'preset'))),
    optional(state.legacyId, 'advance'), optional(state.bubbleId, 'bubble'),
    Promise.all((state.worldbookIds ?? []).map(id => optional(id, 'worldbook'))),
    Promise.all((state.regexIds ?? []).map(id => optional(id, 'regex'))),
  ]);
  const agentPresets = Object.fromEntries([
    ...(presetItem ? [[presetItem.id, presetItem.data]] : []),
    ...extraPresetItems.filter(Boolean).map(item => [item.id, item.data]),
  ]);
  const original = cardItem.data.data ?? cardItem.data;
  const card = state.worldbookOverrides?.[state.cardId] ? { ...original, character_book: { ...original.character_book, entries: state.worldbookOverrides[state.cardId] } } : original;
  const overrideBook = book => state.worldbookOverrides?.[book.id] ? { ...book, data: { ...book.data, entries: state.worldbookOverrides[book.id] } } : book;
  const books = extraBooks.map(overrideBook);
  const profile = legacyItem?.data?.plotSettings ?? legacyItem?.data;
  const options = (Array.isArray(profile?.plotTasks) ? profile.plotTasks : []).filter(task => task.enabled !== false)
    .map(task => ({ ...profile, ...Object.fromEntries(Object.entries(task).filter(([, value]) => value !== undefined)) }));
  let advanceWorldbooks;
  if (options.some(option => option.worldbookEnabled !== false && (option.plotWorldbookConfig?.source || option.worldbookSource))) {
    const directory = card.character_book ? [{ id: cardItem.id, name: card.character_book.name ?? card.name, source: 'character', data: card.character_book }] : [];
    if (options.some(option => option.worldbookEnabled !== false && manualSelection(option)?.length)) {
      directory.push(...(await store.library()).filter(item => item.kind === 'worldbook').map(item => ({ ...item, source: 'manual' })));
    }
    const selected = [...new Set(options.flatMap(option => selectAdvanceWorldbooks(directory, option)))];
    advanceWorldbooks = await Promise.all(selected.map(async book => book.source === 'character' ? book
      : { ...overrideBook(extraBooks.find(item => item.id === book.id) ?? await optional(book.id, 'worldbook')), source: 'manual' }));
  }
  return { cardItem, card, presetItem, preset: state.presetOverride ?? presetItem?.data ?? defaultWritingPreset, toolPreset: state.toolPresetId ? agentPresets[state.toolPresetId] ?? null : null, agentPresets, legacy: legacyItem?.data, bubbleItem, extraBooks: books,
    ...(advanceWorldbooks ? { advanceWorldbooks } : {}), regex: state.extensionSettings?.regex ?? extraRegex.flatMap(item => Array.isArray(item.data) ? item.data : [item.data]) };
}
