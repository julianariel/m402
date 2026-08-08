import Database from 'better-sqlite3';

// The on-chain `receipts` set proves a secret paid — once, ever. It does not
// prove this particular request hasn't already redeemed it: the set is
// append-only and a payment landing is not the same as an access grant being
// spent. This is the gateway's own local replay guard, per the #6 comment.
export type ConsumedReceipts = {
  isConsumed(receiptHex: string): boolean;
  markConsumed(receiptHex: string): 'consumed' | 'already-consumed';
};

export function createConsumedReceipts(dbPath: string): ConsumedReceipts {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS consumed_receipts (
      receipt    TEXT PRIMARY KEY,
      consumedAt TEXT NOT NULL
    )
  `);

  const checkStmt = db.prepare<[string], { receipt: string }>(
    'SELECT receipt FROM consumed_receipts WHERE receipt = ?'
  );
  const insertStmt = db.prepare('INSERT INTO consumed_receipts (receipt, consumedAt) VALUES (?, ?)');

  return {
    isConsumed(receiptHex) {
      return checkStmt.get(receiptHex) !== undefined;
    },
    markConsumed(receiptHex) {
      try {
        insertStmt.run(receiptHex, new Date().toISOString());
        return 'consumed';
      } catch (err) {
        if (err instanceof Error && 'code' in err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
          return 'already-consumed';
        }
        throw err;
      }
    },
  };
}
