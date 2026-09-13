// EXACT empty-table boundary only; no SQL safety simulation.
export function describeTables(data = {}) {
  if (Object.keys(data).some(key => key.startsWith('sheet_'))) throw new Error('Offline integration cannot certify Node26 SQLite tables');
  return [];
}
export function applyTableOperations(data, operations) {
  describeTables(data);
  if (operations.length) throw new Error('Offline integration refuses to simulate SQL operations');
  return structuredClone(data);
}
export function exportLegacyTables(data) { return structuredClone(data); }
