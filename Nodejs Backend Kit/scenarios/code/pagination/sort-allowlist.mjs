// ?sort=-total  ->  a fixed ORDER BY that always ends with the unique id
const SORTS = { createdAt: 'created_at', total: 'total' };   // public name to real column

export function orderBy(sortParam = '-createdAt') {
  const desc = sortParam.startsWith('-');
  const column = SORTS[desc ? sortParam.slice(1) : sortParam];
  if (!column) return null;                                  // caller answers 422
  const dir = desc ? 'DESC' : 'ASC';
  return `ORDER BY ${column} ${dir}, id ${dir}`;             // id keeps pages stable
}

if (import.meta.main) {
  for (const s of ['-total', 'createdAt', 'passwordHash', 'total; DROP TABLE orders', undefined]) {
    console.log(JSON.stringify(s ?? null).padEnd(28), '->', orderBy(s));
  }
}
