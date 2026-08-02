// Import flights from a JSON file into the flights table.
// The format is exactly what GET /api/export/json produces ({ flights: [...] }), or a bare array —
// so an export file round-trips back in unchanged. id and seq are always regenerated (DB-assigned);
// created_at is always regenerated too (stamped with the import time, not carried over from the file);
// fm_no/fm_id/updated_at pass through when present so a backup export restores with its migration
// numbers (and `npm run verify` anchors) intact.
//
// Usage:
//   npm run import:json -- path/to/flights.json            (only into an EMPTY flights table)
//   npm run import:json -- path/to/flights.json --force    (wipe & replace; dumps a backup JSON first)
//   npm run import:json -- path/to/flights.json --dry-run  (preview: row count/date range/fm_no count
//                                                            and any problems found — no DB writes)
import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "../server/db.js";
import { validateRow, formatIssuesTable, type RowIssue } from "./lib/validate.js";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const file = process.argv.slice(2).find((a) => a !== "--force" && a !== "--dry-run");
if (!file) {
  console.error("usage: npm run import:json -- <file.json> [--force] [--dry-run]");
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

// [C2-b]: field prep mirrors the API's own normalizeFlightBody (server/routes.ts) as closely as
// possible — trim strings (empty -> null), coerce/round numeric fields — so this importer ends up
// neither looser nor stricter than the UI/API path it is meant to mirror. Format/enum validation itself
// is delegated to validateRow (migration/lib/validate.ts), shared with import-fr24.ts.
const prepared = rows.map((r) => {
  const row: Record<string, unknown> = {};
  for (const k of FIELDS) {
    let v = r[k];
    if (typeof v === "string") v = v.trim() || null;
    row[k] = v ?? null;
  }
  for (const k of ["dep_iata", "arr_iata"] as const) {
    if (typeof row[k] === "string") row[k] = (row[k] as string).toUpperCase();
  }
  for (const k of ["distance_km", "duration_min"] as const) {
    if (row[k] != null) row[k] = Math.round(Number(row[k]));
  }
  row.arr_day_offset = row.arr_day_offset == null ? 0 : Number(row.arr_day_offset);
  row.flight_role = row.flight_role ?? "passenger";
  return row;
});

// [C2-b]: collect every row's problems instead of throwing on the first one — a hand-edited or
// converted file tends to repeat the same mistake many times, and one run should surface all of them.
const issues: RowIssue[] = prepared.flatMap((row, i) => validateRow(row, i + 1));

const validDates = prepared
  .map((r) => r.date)
  .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
  .sort();
const fmNoCount = prepared.filter((r) => r.fm_no != null).length;
console.log(`rows:       ${prepared.length}`);
console.log(`date range: ${validDates.length ? `${validDates[0]} .. ${validDates[validDates.length - 1]}` : "n/a"}`);
console.log(`fm_no set:  ${fmNoCount}`);

if (issues.length > 0) {
  console.error(`\n${issues.length} problem(s) found — no changes made:\n`);
  console.error(formatIssuesTable(issues));
  process.exit(1);
}

if (dryRun) {
  console.log(`\n--dry-run: no problems found, no changes made.`);
  process.exit(0);
}

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
