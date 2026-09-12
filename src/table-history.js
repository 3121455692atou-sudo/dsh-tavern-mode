import { describeTables, applyTableOperations } from './tables.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function changesBetween(before = {}, after = {}) {
  const result = [];
  const layouts = new Map(describeTables(after).map(table => [table.id, table]));
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = before[key], next = after[key];
    if (equal(old, next)) continue;
    if (!key.startsWith('sheet_') || !old || !next || !equal({ ...old, content: null }, { ...next, content: null }) || !equal(old.content[0], next.content[0])) {
      result.push({ key, replace: true, value: next }); continue;
    }
    const layout = layouts.get(key), keyIndex = layout.columns.findIndex(column => column.name === layout.keyColumn);
    const oldRows = new Map(old.content.slice(1).map(row => [row[keyIndex], row]));
    const nextRows = new Map(next.content.slice(1).map(row => [row[keyIndex], row]));
    for (const id of new Set([...oldRows.keys(), ...nextRows.keys()])) {
      const left = oldRows.get(id), right = nextRows.get(id);
      if (equal(left, right)) continue;
      result.push({ key, keyIndex, rowId: id, op: !left ? 'insert' : !right ? 'delete' : 'update',
        ...(right ? { cells: right.flatMap((value, column) => !left || !equal(value, left[column]) ? [[column, value]] : []) } : {}) });
    }
  }
  return result;
}

export function recordTableChanges(state, nextTables, { turnId, sourceMessageIds = [], scene } = {}) {
  state.tableHistory ??= { base: structuredClone(state.tables ?? {}), scene: structuredClone(state.scene), events: [] };
  const changes = changesBetween(state.tables, nextTables);
  if (changes.length || scene) state.tableHistory.events.push({ turnId, sourceMessageIds, changes, ...(scene ? { scene: structuredClone(scene) } : {}) });
}

export function removeTableSources(state, removedIds) {
  if (!state.tableHistory) return;
  const removed = new Set(removedIds), journal = state.tableHistory;
  journal.events = journal.events.filter(event => !event.sourceMessageIds.some(id => removed.has(id)));
  const tables = structuredClone(journal.base);
  let scene = structuredClone(journal.scene);
  for (const event of journal.events) {
    for (const change of event.changes) {
      if (change.replace) {
        if (change.value === undefined) delete tables[change.key];
        else tables[change.key] = structuredClone(change.value);
        continue;
      }
      const rows = tables[change.key]?.content;
      if (!rows) continue;
      const index = rows.findIndex((row, i) => i > 0 && row[change.keyIndex] === change.rowId);
      if (change.op === 'delete') { if (index > 0) rows.splice(index, 1); }
      else if (change.op === 'insert') {
        if (index < 0) { const row = Array(rows[0].length).fill(null); for (const [column, value] of change.cells) row[column] = value; rows.push(row); }
      } else if (index > 0) for (const [column, value] of change.cells) rows[index][column] = value;
    }
    if (event.scene) scene = structuredClone(event.scene);
  }
  state.tables = applyTableOperations(tables, []);
  state.scene = scene;
}

export async function ensureTableHistory(store, state) {
  if (state.tableHistory) return;
  const versions = [state];
  let previous = state;
  while (previous.previousRevision) { previous = await store.session(state.id, previous.previousRevision); versions.unshift(previous); }
  const retainedMessages = new Map(state.messages.map(message => [message.id, message]));
  const replay = { tables: versions[0].tables, scene: versions[0].scene };
  recordTableChanges(replay, replay.tables);
  for (let i = 1; i < versions.length; i++) {
    const current = versions[i], prior = versions[i - 1];
    const previousIds = new Set(prior.messages.map(message => message.id));
    const authored = current.messages.findLast(message => message.role === 'assistant' && message.turnId && !previousIds.has(message.id));
    const sources = authored ? current.messages.filter(message => message.turnId === authored.turnId) : [];
    if (sources.length && sources.some(message => retainedMessages.get(message.id)?.content !== message.content)) continue;
    if (!sources.length && !equal(current.messages.map(message => message.id), prior.messages.map(message => message.id))) continue;
    replay.tables = prior.tables;
    recordTableChanges(replay, current.tables, { turnId: authored?.turnId, sourceMessageIds: sources.map(message => message.id), ...(!equal(current.scene, prior.scene) ? { scene: current.scene } : {}) });
  }
  state.tableHistory = replay.tableHistory;
  const retained = new Set(state.messages.map(message => message.id));
  removeTableSources(state, state.tableHistory.events.flatMap(event => event.sourceMessageIds.filter(id => !retained.has(id))));
}
