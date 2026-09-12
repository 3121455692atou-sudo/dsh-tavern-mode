const equal = (a, b) => a === b || (a !== null && b !== null && String(a) === String(b));

class Query {
  constructor(rows) { this.rows = rows; }
  where(field, operator, value) {
    if (arguments.length === 2) { value = operator; operator = '='; }
    const compare = {
      '=': equal, '==': equal, '===': (a, b) => a === b,
      '!=': (a, b) => !equal(a, b), '<>': (a, b) => !equal(a, b),
      '>': (a, b) => a > b, '>=': (a, b) => a >= b,
      '<': (a, b) => a < b, '<=': (a, b) => a <= b,
      'like': (a, b) => new RegExp(`^${String(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('%', '.*').replaceAll('_', '.')}$`, 's').test(String(a)),
    }[String(operator).toLowerCase()];
    if (!compare) throw new Error(`不支持的查询操作符 ${operator}`);
    return new Query(this.rows.filter(row => Object.hasOwn(row, field) && compare(row[field], value)));
  }
  whereIn(field, values) { return new Query(this.rows.filter(row => values.some(value => equal(row[field], value)))); }
  whereNotIn(field, values) { return new Query(this.rows.filter(row => !values.some(value => equal(row[field], value)))); }
  whereNull(field) { return this.where(field, null); }
  whereNotNull(field) { return new Query(this.rows.filter(row => row[field] != null)); }
  exists() { return this.rows.length > 0; }
  count() { return this.rows.length; }
  first() { return this.rows[0] ?? null; }
  last() { return this.rows.at(-1) ?? null; }
  all() { return this.rows; }
  get() { return this.rows; }
  value(field) { return this.rows[0]?.[field] ?? null; }
  pluck(field) { return this.rows.map(row => row[field]); }
  sum(field) { return this.rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0); }
  max(field) { return this.rows.length ? Math.max(...this.pluck(field).map(Number)) : null; }
  min(field) { return this.rows.length ? Math.min(...this.pluck(field).map(Number)) : null; }
  orderBy(field, direction = 'asc') { return new Query([...this.rows].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1))); }
  limit(count) { return new Query(this.rows.slice(0, count)); }
}

export function queryFacade(tables) {
  const db = Object.create(null);
  for (const table of tables) {
    const rows = table.rows.map(values => {
      const row = Object.create(null);
      table.headers.forEach((header, i) => { row[header] = values[i]; row[table.columns[i].name] = values[i]; });
      return row;
    });
    for (const key of [table.id, table.uid, table.name, table.sqlName]) if (key) db[key] = new Query(rows);
  }
  return new Proxy(db, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (Object.hasOwn(target, prop)) return target[prop];
      return new Query([]);
    },
  });
}
