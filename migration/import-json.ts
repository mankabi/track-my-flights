// Import flights from a JSON file into the flights table.
// The format is exactly what GET /api/export/json produces ({ flights: [...] }), or a bare array —
// so an export file round-trips back in unchanged (fields like id/seq are ignored and regenerated).
//
// Usage:
//   npm run import:json -- path/to/flights.json            (only into an EMPTY flights table)
//   npm run import:json -- path/to/flights.json --force    (wipe & replace; dumps a backup JSON first)
import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "../server/db.js";

const args = process.argv.slice(2).filter((a) => a !== "--force");
const force = process.argv.includes("--force");
const file = args[0];
if (!file) {
  console.error("usage: npm run import:json -- <file.json> [--force]");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw?.flights;
if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error(`no flights found in ${file} — expected { "flights": [...] } or a bare array`);
}

// Columns we accept. id/seq/created_at are regenerated; fm_no/fm_id/updated_at pass through when present
// so a backup export restores with its migration numbers (and `npm run verify` anchors) intact.
const FIELDS = [
  "fm_no", "fm_id", "date", "dep_time", "arr_time", "arr_day_offset",
  "dep_iata", "dep_city", "dep_country", "dep_airport_name",
  "arr_iata", "arr_city", "arr_country", "arr_airport_name",
  "distance_km", "duration_min", "airline", "flight_no",
  "aircraft_type", "aircraft_reg", "aircraft_name", "seat", "seat_pos",
  "travel_class", "flight_role", "flight_reason", "comment", "updated_at",
] as const;

const prepared = rows.map((r, i) => {
  const row: Record<string, unknown> = {};
  for (const k of FIELDS) row[k] = r[k] ?? null;
  if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    throw new Error(`row ${i + 1}: date must be YYYY-MM-DD (got ${JSON.stringify(r.date)})`);
  }
  for (const k of ["dep_iata", "arr_iata"] as const) {
    if (typeof row[k] !== "string" || !/^[A-Za-z]{3}$/.test(row[k] as string)) {
      throw new Error(`row ${i + 1}: ${k} must be a 3-letter IATA code (got ${JSON.stringify(r[k])})`);
    }
    row[k] = (row[k] as string).toUpperCase();
  }
  row.arr_day_offset = row.arr_day_offset == null ? 0 : Number(row.arr_day_offset);
  if (!Number.isInteger(row.arr_day_offset)) throw new Error(`row ${i + 1}: arr_day_offset must be an integer`);
  row.flight_role = row.flight_role ?? "passenger";
  return row;
});

// Same guard as the migration tool: importing is an initial-load operation. If the table already has
// data (including rows you edited after a previous import), refuse — unless --force, which first dumps
// everything to data/backups/ so nothing is silently lost.
const total = (db.prepare("SELECT COUNT(*) AS n FROM flights").get() as { n: number }).n;
if (total > 0) {
  if (!force) {
    throw new Error(
      `refusing to import: flights table already has ${total} rows. ` +
        `Importing replaces everything. If that is what you want, run \`npm run import:json -- ${file} --force\` ` +
        `(a JSON backup of the current table is written to data/backups/ first).`,
    );
  }
  const dumpRows = db.prepare("SELECT * FROM flights ORDER BY date, id").all();
  const backupsDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const dumpPath = path.join(backupsDir, `pre-import-${ts}.json`);
  fs.writeFileSync(
    dumpPath,
    JSON.stringify({ dumpedAt: new Date().toISOString(), reason: "pre-import --force", flights: dumpRows }, null, 2),
  );
  console.log(`--force: dumped ${total} existing rows to ${dumpPath}, replacing them now`);
}

const cols = FIELDS.join(", ");
const params = FIELDS.map((k) => `@${k}`).join(", ");
const insert = db.prepare(`INSERT INTO flights (${cols}) VALUES (${params})`);
db.transaction(() => {
  db.prepare("DELETE FROM flights").run();
  for (const row of prepared) insert.run(row);
})();

console.log(`imported ${prepared.length} flights from ${file}`);
const offsets = db
  .prepare("SELECT date, dep_iata, arr_iata, arr_day_offset FROM flights WHERE ABS(arr_day_offset) > 2")
  .all();
if (offsets.length) {
  console.warn("warning: unusual arrival-day offsets (kept as-is — fix them in the app if wrong):");
  console.table(offsets);
}
