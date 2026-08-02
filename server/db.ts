import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const DB_PATH = process.env.MFM_DB_PATH ?? path.join(DATA_DIR, "flights.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// v1.6 D37: travel_class CHECK gained 'private' (FR24 "Flight class"=5 has no other home in our
// vocabulary). Column list lives in one constant so the fresh-DB CREATE TABLE below and the
// existing-DB migration further down (which rebuilds the table under a new CHECK) never drift apart.
const FLIGHTS_COLUMNS = `
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fm_no            INTEGER,
  fm_id            INTEGER,
  date             TEXT NOT NULL,
  dep_time         TEXT,
  arr_time         TEXT,
  arr_day_offset   INTEGER NOT NULL DEFAULT 0,
  dep_iata         TEXT NOT NULL,
  dep_city         TEXT,
  dep_country      TEXT,
  dep_airport_name TEXT,
  arr_iata         TEXT NOT NULL,
  arr_city         TEXT,
  arr_country      TEXT,
  arr_airport_name TEXT,
  distance_km      INTEGER,
  duration_min     INTEGER,
  airline          TEXT,
  flight_no        TEXT,
  aircraft_type    TEXT,
  aircraft_reg     TEXT,
  aircraft_name    TEXT,
  seat             TEXT,
  seat_pos         TEXT CHECK (seat_pos IN ('window','aisle','middle') OR seat_pos IS NULL),
  travel_class     TEXT CHECK (travel_class IN ('economy','economyplus','business','first','private') OR travel_class IS NULL),
  flight_role      TEXT NOT NULL DEFAULT 'passenger' CHECK (flight_role IN ('passenger','crew','cockpit')),
  flight_reason    TEXT CHECK (flight_reason IN ('personal','business','virtual') OR flight_reason IS NULL),
  comment          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
`;

db.exec(`
CREATE TABLE IF NOT EXISTS airports (
  iata         TEXT PRIMARY KEY,
  icao         TEXT,
  name         TEXT NOT NULL,
  city         TEXT,
  country      TEXT,
  country_code TEXT,
  continent    TEXT,
  lat          REAL,
  lon          REAL,
  tz           TEXT
);

CREATE TABLE IF NOT EXISTS airlines (
  iata    TEXT PRIMARY KEY,
  icao    TEXT,
  name    TEXT NOT NULL,
  country TEXT,
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS flights (${FLIGHTS_COLUMNS});

CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(date);
CREATE INDEX IF NOT EXISTS idx_flights_route ON flights(dep_iata, arr_iata);
`);

migrateTravelClassPrivate();

// v1.6 D37: idempotently upgrade a pre-existing DB whose flights.travel_class CHECK does not yet allow
// 'private'. SQLite cannot ALTER a CHECK constraint, so this follows the standard 12-step table-rebuild
// recipe (sqlite.org "Making Other Kinds Of Table Schema Changes"): back up -> create the new-schema
// table -> copy rows across -> drop the old table -> rename. A no-op on a fresh DB (already has
// 'private' from FLIGHTS_COLUMNS above) and a no-op on an already-migrated DB. On failure, the
// transaction auto-rolls back and this rethrows — startup is meant to abort rather than run with a
// half-migrated schema.
function migrateTravelClassPrivate(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'flights'")
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'private'")) return; // no flights table yet, or already migrated

  // Colocate with the DB actually in use (path.dirname(DB_PATH)), not the hardcoded repo DATA_DIR —
  // same convention as migration/import-json.ts and migration/migrate.ts, so MFM_DB_PATH overrides
  // (tests, scratch DBs) never spill a backup file into this repo's own data/backups/.
  const backupsDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const backupPath = path.join(backupsDir, `pre-schema-private-${ts}.db`);
  db.prepare("VACUUM INTO ?").run(backupPath);
  console.log(`schema migration: backed up pre-'private' database to ${backupPath}`);

  db.pragma("foreign_keys = OFF"); // must be set outside any transaction to take effect
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE flights_new (${FLIGHTS_COLUMNS});`);
      db.exec(`INSERT INTO flights_new SELECT * FROM flights;`);
      db.exec(`DROP TABLE flights;`);
      db.exec(`ALTER TABLE flights_new RENAME TO flights;`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(date);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_flights_route ON flights(dep_iata, arr_iata);`);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  console.log("schema migration: flights.travel_class now allows 'private'");
}
