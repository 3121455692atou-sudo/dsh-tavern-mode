const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const avatarAlias = name => `_global___${String(name).trim().toLowerCase()}`;
const keyed = (values = []) => new Map(values.map(value => [value.name, value]));
const recordKey = record => JSON.stringify(record.key);

export function diffStorage(before = {}, after = {}) {
  const patch = { local: [], databases: [] };
  for (const key of new Set([...Object.keys(before.local ?? {}), ...Object.keys(after.local ?? {})])) {
    if ((before.local ?? {})[key] === (after.local ?? {})[key]) continue;
    patch.local.push(Object.hasOwn(after.local ?? {}, key) ? { key, value: after.local[key] } : { key, deleted: true });
  }
  const previous = keyed(before.databases), next = keyed(after.databases);
  for (const name of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(name), database = next.get(name);
    if (!database) { patch.databases.push({ name, deleted: true }); continue; }
    const change = { name, version: database.version, stores: [] };
    const oldStores = keyed(old?.stores), newStores = keyed(database.stores);
    for (const storeName of new Set([...oldStores.keys(), ...newStores.keys()])) {
      const prior = oldStores.get(storeName), store = newStores.get(storeName);
      if (!store) { change.stores.push({ name: storeName, deleted: true }); continue; }
      const { records, ...schema } = store;
      const { records: oldRecords = [], ...oldSchema } = prior ?? {};
      const changed = { name: storeName, records: [] };
      if (!same(schema, oldSchema)) changed.schema = schema;
      const oldRows = new Map(oldRecords.map(row => [recordKey(row), row]));
      const newRows = new Map(records.map(row => [recordKey(row), row]));
      for (const key of new Set([...oldRows.keys(), ...newRows.keys()])) {
        if (same(oldRows.get(key), newRows.get(key))) continue;
        changed.records.push(newRows.get(key) ?? { key: oldRows.get(key).key, deleted: true });
      }
      if (changed.schema || changed.records.length) change.stores.push(changed);
    }
    if (!old || old.version !== database.version || change.stores.length) patch.databases.push(change);
  }
  return patch;
}

export function mergeStorage(snapshot = {}, patch) {
  const result = structuredClone({ local: {}, databases: [], ...snapshot });
  for (const change of patch.local) {
    if (change.deleted) delete result.local[change.key];
    else Object.defineProperty(result.local, change.key, { value: change.value, enumerable: true, writable: true, configurable: true });
  }
  const databases = keyed(result.databases);
  for (const change of patch.databases) {
    if (change.deleted) { databases.delete(change.name); continue; }
    const database = databases.get(change.name) ?? { name: change.name, version: change.version, stores: [] };
    database.version = Math.max(database.version, change.version);
    const stores = keyed(database.stores);
    for (const update of change.stores) {
      if (update.deleted) { stores.delete(update.name); continue; }
      const prior = stores.get(update.name);
      if (!prior && !update.schema) throw new Error('前端存储结构已改变，请刷新后重试');
      const store = { ...prior, ...update.schema };
      const rows = new Map((prior?.records ?? []).map(row => [recordKey(row), row]));
      for (const row of update.records) row.deleted ? rows.delete(recordKey(row)) : rows.set(recordKey(row), row);
      store.records = [...rows.values()]; stores.set(update.name, store);
    }
    database.stores = [...stores.values()]; databases.set(change.name, database);
  }
  result.databases = [...databases.values()];
  return result;
}
