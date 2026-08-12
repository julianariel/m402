import Database from 'better-sqlite3';
import type { Service } from '@m402/shared';

export type Registry = {
  get(id: string): Service | undefined;
  list(): Service[];
  insert(row: Service): 'created' | 'conflict';
};

type ServiceRow = {
  id: string;
  price: string;
  owner: string;
  type: 'origin' | 'relay';
  target: string;
  chain: string | null;
  description: string | null;
};

function rowToService(row: ServiceRow): Service {
  return {
    id: row.id,
    price: BigInt(row.price),
    owner: row.owner,
    type: row.type,
    target: row.target,
    chain: row.chain ?? undefined,
    description: row.description ?? undefined,
  };
}

/** Added after the table existed, so an existing `gateway.db` needs an ALTER TABLE rather than
 * relying on CREATE TABLE IF NOT EXISTS — that statement only fires against a table that
 * doesn't exist yet, and is a no-op against an already-created one missing the column. */
function ensureDescriptionColumn(db: Database.Database): void {
  const columns = db.pragma('table_info(services)') as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'description')) {
    db.exec('ALTER TABLE services ADD COLUMN description TEXT');
  }
}

export function createRegistry(dbPath: string): Registry {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id     TEXT PRIMARY KEY,
      price  TEXT NOT NULL,
      owner  TEXT NOT NULL,
      type   TEXT NOT NULL,
      target TEXT NOT NULL,
      chain  TEXT
    )
  `);
  ensureDescriptionColumn(db);

  const getStmt = db.prepare<[string], ServiceRow>('SELECT * FROM services WHERE id = ?');
  const listStmt = db.prepare<[], ServiceRow>('SELECT * FROM services');
  const insertStmt = db.prepare(
    'INSERT INTO services (id, price, owner, type, target, chain, description) VALUES (@id, @price, @owner, @type, @target, @chain, @description)'
  );

  return {
    get(id) {
      const row = getStmt.get(id);
      return row ? rowToService(row) : undefined;
    },
    list() {
      return listStmt.all().map(rowToService);
    },
    insert(service) {
      try {
        insertStmt.run({
          id: service.id,
          price: service.price.toString(),
          owner: service.owner,
          type: service.type,
          target: service.target,
          chain: service.chain ?? null,
          description: service.description ?? null,
        });
        return 'created';
      } catch (err) {
        if (err instanceof Error && 'code' in err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
          return 'conflict';
        }
        throw err;
      }
    },
  };
}
