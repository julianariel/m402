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
};

function rowToService(row: ServiceRow): Service {
  return {
    id: row.id,
    price: BigInt(row.price),
    owner: row.owner,
    type: row.type,
    target: row.target,
    chain: row.chain ?? undefined,
  };
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

  const getStmt = db.prepare<[string], ServiceRow>('SELECT * FROM services WHERE id = ?');
  const listStmt = db.prepare<[], ServiceRow>('SELECT * FROM services');
  const insertStmt = db.prepare(
    'INSERT INTO services (id, price, owner, type, target, chain) VALUES (@id, @price, @owner, @type, @target, @chain)'
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
