import { createHash } from 'node:crypto';
import { readJson, atomicJson } from './storage.js';
import { join } from 'node:path';

export const configurationFields = ['config', 'presetOverride', 'extensionSettings', 'worldbookSettings', 'regexOrder'];
export const selectionFields = ['cardId', 'presetId', 'toolPresetId', 'tableId', 'legacyId', 'bubbleId', 'renderMode', 'userName', 'persona', 'worldbookIds', 'regexIds'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const file = store => join(store.root, 'saved-configurations.json');

export async function configurationHistory(store) {
  return (await readJson(file(store), [])).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveConfiguration(store, { selection, configuration = {} }) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error('角色卡设置无效');
  const library = await store.library();
  const names = new Map(library.map(item => [item.id, item.name]));
  const snapshot = {
    selection: { presetId: null, toolPresetId: null, tableId: null, legacyId: null, bubbleId: null, worldbookIds: [], regexIds: [], persona: '', ...pick(selection, selectionFields) },
    configuration: { extensionSettings: {}, worldbookSettings: {}, regexOrder: [0, 2, 1], presetOverride: null, ...pick(configuration, configurationFields) },
  };
  if (snapshot.configuration.extensionSettings?.variables) { snapshot.configuration.extensionSettings = { ...snapshot.configuration.extensionSettings }; delete snapshot.configuration.extensionSettings.variables; }
  const profile = {
    id: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    ...snapshot,
    updatedAt: new Date().toISOString(),
    name: `${names.get(snapshot.selection.cardId) ?? '未选角色卡'} · ${names.get(snapshot.selection.presetId) ?? 'SillyTavern Default'}`,
  };
  const next = [profile, ...(await configurationHistory(store)).filter(item => item.id !== profile.id)];
  await atomicJson(file(store), next);
  return next;
}
