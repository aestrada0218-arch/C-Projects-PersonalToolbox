import type { Database } from "sql.js";
// Build an actual pre-v0.4 collection schema when testing earlier migration paths.
export function makeCollectionV4(db: Database) {
  makeShippingV5(db);
  db.run(`DROP TABLE collection_quotes; DROP TABLE collection_settings;
ALTER TABLE collection RENAME TO collection_current;
CREATE TABLE collection(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),purchase REAL NOT NULL,market REAL NOT NULL);
INSERT INTO collection(id,name,category,quantity,purchase,market) SELECT id,name,category,quantity,purchase,market FROM collection_current;
DROP TABLE collection_current;
DELETE FROM migrations WHERE version=5;`);
}
export function makeShippingV5(db: Database) {
  db.run(
    "DROP TABLE IF EXISTS shipping_receipts; DROP TABLE IF EXISTS shipping_tasks; DROP TABLE IF EXISTS shipping_monitor; DELETE FROM migrations WHERE version=6;",
  );
}
