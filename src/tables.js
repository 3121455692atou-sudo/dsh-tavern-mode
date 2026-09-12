import { DatabaseSync, constants as C } from 'node:sqlite';

const quote = name => `"${String(name).replaceAll('"', '""')}"`;
const cell = value => typeof value === 'boolean' ? Number(value) : value;

function createTable(db, sheet, index) {
  const headers = sheet.content?.[0];
  if (!Array.isArray(headers) || !headers.length || headers.some(h => typeof h !== 'string' || !h)) throw new Error(`表格 ${sheet.name} 缺少有效表头`);
  if (new Set(headers).size !== headers.length) throw new Error(`表格 ${sheet.name} 有重复列名`);
  const ddl = sheet.sourceData?.ddl;
  let sqlName;
  if (typeof ddl === 'string' && ddl.trim()) {
    const names = [];
    db.setAuthorizer((action, arg1, arg2, database) => {
      if (database && database !== 'main') return C.SQLITE_DENY;
      if (action === C.SQLITE_CREATE_TABLE) { names.push(arg1); return C.SQLITE_OK; }
      if ([C.SQLITE_CREATE_INDEX, C.SQLITE_READ, C.SQLITE_SELECT].includes(action)) return C.SQLITE_OK;
      if ([C.SQLITE_INSERT, C.SQLITE_UPDATE].includes(action) && arg1 === 'sqlite_master') return C.SQLITE_OK;
      if (action === C.SQLITE_FUNCTION && arg2 !== 'load_extension') return C.SQLITE_OK;
      return C.SQLITE_DENY;
    });
    try { db.exec(ddl); }
    finally { db.setAuthorizer(null); }
    if (names.length !== 1) throw new Error(`表格 ${sheet.name} 的 DDL 必须只定义一张表`);
    sqlName = names[0];
  } else {
    sqlName = `tavern_${index}`;
    db.exec(`CREATE TABLE ${quote(sqlName)} (${headers.map((h, i) => `${quote(h)}${i === 0 && h === 'row_id' ? ' INTEGER PRIMARY KEY' : ''}`).join(',')})`);
  }
  const columns = db.prepare(`PRAGMA table_info(${quote(sqlName)})`).all();
  if (columns.length !== headers.length) throw new Error(`表格 ${sheet.name} 的 DDL 与表头列数不一致`);
  const primary = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk);
  if (primary.length > 1) throw new Error(`表格 ${sheet.name} 使用复合主键，请改为单个行标识后导入`);
  const keyColumn = primary[0]?.name ?? columns[0].name;
  const insert = db.prepare(`INSERT INTO ${quote(sqlName)} (${columns.map(c => quote(c.name)).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  for (const row of sheet.content.slice(1)) {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`表格 ${sheet.name} 的数据列数不一致`);
    insert.run(...row.map(cell));
  }
  return { ...sheet, sqlName, columns, keyColumn, headers };
}

export function withTables(data, run) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
  db.limits.sqlLength = 2_000_000;
  db.limits.length = 16_000_000;
  try {
    const tables = Object.entries(data ?? {}).filter(([key]) => key.startsWith('sheet_')).sort((a, b) => (a[1].orderNo ?? 0) - (b[1].orderNo ?? 0))
      .map(([key, sheet], index) => ({ ...createTable(db, sheet, index), key }));
    return run(db, tables);
  } finally { db.close(); }
}

export function describeTables(data) {
  return withTables(data, (db, tables) => tables.map(table => ({
    id: table.key, uid: table.uid, name: table.name, sqlName: table.sqlName, keyColumn: table.keyColumn,
    headers: table.headers, columns: table.columns, rows: table.content.slice(1),
    instructions: table.sourceData ?? {}, updateConfig: table.updateConfig ?? {}, exportConfig: table.exportConfig ?? {},
  })));
}

export function applyTableOperations(data, operations) {
  return withTables(data, (db, tables) => {
    const next = structuredClone(data);
    db.exec('BEGIN');
    try {
      for (const operation of operations) {
        const table = tables.find(t => [t.key, t.uid, t.name, t.sqlName].includes(operation.table));
        if (!table) throw new Error(`填表引用了不存在的表：${operation.table}`);
        const values = Object.entries(operation.values ?? {}).map(([key, value]) => {
          const index = table.headers.indexOf(key);
          const name = index >= 0 ? table.columns[index].name : key;
          if (!table.columns.some(c => c.name === name)) throw new Error(`表格 ${table.name} 中不存在列 ${key}`);
          if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('表格单元格只能是文本、数字、布尔值或 null');
          return [name, cell(value)];
        });
        if (new Set(values.map(([key]) => key)).size !== values.length) throw new Error('同一列不能同时使用中文名和 SQL 名更新');
        if (operation.op === 'insert') {
          if (!values.length) db.exec(`INSERT INTO ${quote(table.sqlName)} DEFAULT VALUES`);
          else db.prepare(`INSERT INTO ${quote(table.sqlName)} (${values.map(([key]) => quote(key)).join(',')}) VALUES (${values.map(() => '?').join(',')})`).run(...values.map(([, value]) => value));
        } else {
          if (operation.rowId === null || operation.rowId === undefined) throw new Error('更新和删除必须提供行标识');
          let result;
          if (operation.op === 'update') {
            if (!values.length) throw new Error('更新操作缺少字段');
            result = db.prepare(`UPDATE ${quote(table.sqlName)} SET ${values.map(([key]) => `${quote(key)}=?`).join(',')} WHERE ${quote(table.keyColumn)}=?`).run(...values.map(([, value]) => value), operation.rowId);
          } else if (operation.op === 'delete') {
            result = db.prepare(`DELETE FROM ${quote(table.sqlName)} WHERE ${quote(table.keyColumn)}=?`).run(operation.rowId);
          } else throw new Error(`未知填表操作：${operation.op}`);
          if (result.changes !== 1) throw new Error(`表格 ${table.name} 中行 ${operation.rowId} 不存在或不唯一`);
        }
      }
      for (const table of tables) {
        const query = db.prepare(`SELECT ${table.columns.map(c => quote(c.name)).join(',')} FROM ${quote(table.sqlName)} ORDER BY ${quote(table.keyColumn)}`);
        query.setReturnArrays(true);
        next[table.key].content = [table.headers, ...query.all()];
      }
      db.exec('COMMIT');
      return next;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
}

export function exportLegacyTables(data) { return structuredClone(data ?? { mate: { type: 'chatSheets', version: 2 } }); }
