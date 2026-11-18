// Fails if the Drizzle schema has changes with no migration. Generating is the only reliable diff,
// so this generates, reports, and removes anything it created.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const snapshot = () => new Set(readdirSync('migrations', { recursive: true }).map(String));
const before = snapshot();
const journalPath = 'migrations/meta/_journal.json';
const journal = readFileSync(journalPath);
const output = execFileSync('pnpm', ['exec', 'drizzle-kit', 'generate'], { encoding: 'utf8' });
const added = [...snapshot()].filter((f) => !before.has(f));
if (added.length > 0) {
  for (const f of added) rmSync(`migrations/${f}`, { force: true });
  writeFileSync(journalPath, journal);
  console.error(`Schema and migrations disagree. Run pnpm db:generate.\nA new migration would add: ${added.join(', ')}`);
  process.exit(1);
}
if (!output.includes('No schema changes')) console.warn(output);
console.log('Schema and migrations agree.');

// Every foreign key needs an index that starts with its columns. SQLite looks up child rows on each parent
// delete and cascade, and without one it scans the whole child table each time.
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(':memory:');
for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(readFileSync(`migrations/${file}`, 'utf8').replaceAll('--> statement-breakpoint', ''));
}
const unindexed = [];
for (const { name: table } of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'`).all()) {
  const keys = new Map();
  for (const fk of db.prepare(`SELECT id, "from" AS col, "table" AS parent FROM pragma_foreign_key_list(?) ORDER BY id, seq`).all(table)) {
    const key = keys.get(fk.id) ?? { cols: [], parent: fk.parent };
    key.cols.push(fk.col);
    keys.set(fk.id, key);
  }
  const indexes = db.prepare(`SELECT name FROM pragma_index_list(?)`).all(table).map(({ name }) => db.prepare(`SELECT name FROM pragma_index_info(?) ORDER BY seqno`).all(name).map((c) => c.name));
  for (const { cols, parent } of keys.values()) {
    const covered = indexes.some((index) => index.length >= cols.length && [...index.slice(0, cols.length)].sort().join() === [...cols].sort().join());
    if (!covered) unindexed.push(`${table}(${cols.join(', ')}) -> ${parent}`);
  }
}
if (unindexed.length > 0) {
  console.error(`Foreign keys with no index that starts with their columns:\n  ${unindexed.join('\n  ')}`);
  process.exit(1);
}
console.log('Every foreign key has an index.');
