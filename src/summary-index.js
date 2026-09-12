import { object, ProtocolError, validateProtocol } from './contracts.js';

export function summaryIndex(tables) {
  const archives = [], currentTables = [], index = [];
  for (const table of tables) {
    const config = table.exportConfig ?? {};
    const legacy = ['纪要表', '总结表'].includes(String(table.name ?? '').trim());
    const configured = config.extraIndexEnabled === true;
    const configuredColumns = configured && Array.isArray(config.extraIndexColumns)
      ? [...new Set(config.extraIndexColumns.filter(name => table.headers.includes(name)))] : [];
    const code = table.headers.find(name => name.trim() === '编码索引');
    const overview = table.headers.find(name => ['概要', '概览'].includes(name.trim()));
    if ((!configured && !legacy) || !code || !overview) { currentTables.push(table); continue; }
    const headers = configuredColumns.length ? configuredColumns : [overview, code];
    const recordIdColumn = code;
    if (!headers.includes(recordIdColumn)) headers.push(recordIdColumn);
    const idColumn = table.headers.indexOf(recordIdColumn);
    const rows = table.rows.filter(row => ['string', 'number'].includes(typeof row[idColumn]) && String(row[idColumn]).trim());
    const ids = [...new Set(rows.map(row => String(row[idColumn])))];
    archives.push({ table, idColumn, rows, ids });
    index.push({ tableId: table.id, name: table.name, recordIdColumn, headers, rows: rows.map(row => headers.map(name => row[table.headers.indexOf(name)])) });
  }
  const selectionSchema = { type: 'array', items: object({ tableId: { type: 'string', minLength: 1 }, recordIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } } }) };
  const retrieve = selectedRecords => {
    validateProtocol(selectedRecords, selectionSchema);
    const seen = new Set();
    return selectedRecords.flatMap(({ tableId, recordIds }) => {
      const archive = archives.find(({ table }) => table.id === tableId);
      if (!archive) throw new ProtocolError(`纪要表不存在：${tableId}`);
      return recordIds.map(recordId => {
        const key = JSON.stringify([tableId, recordId]);
        if (seen.has(key)) throw new ProtocolError('纪要选择含重复记录');
        seen.add(key);
        const matches = archive.rows.filter(row => String(row[archive.idColumn]) === recordId);
        if (matches.length !== 1) throw new ProtocolError(`纪要记录不存在或不唯一：${tableId}/${recordId}`);
        return { tableId, recordId, name: archive.table.name, headers: archive.table.headers, row: matches[0] };
      });
    });
  };
  return { index, currentTables, selectionSchema, retrieve };
}
