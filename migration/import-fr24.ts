// [C2] Import flights from a MyFlightRadar24 (FR24) CSV export (WORKBOOK §16, D37/D39/D40).
//
// Usage:
//   npm run import:fr24 -- path/to/export.csv            (only into an EMPTY flights table)
//   npm run import:fr24 -- path/to/export.csv --force     (wipe & replace; dumps a JSON backup first)
//   npm run import:fr24 -- path/to/export.csv --dry-run    (preview only — reads the reference DB to
//                                                            resolve airports/offsets, never writes)
//
// Unlike import-json.ts (all-or-nothing, because that format is our own canonical export and any
// deviation signals corruption), this importer is best-effort: a row with an unresolvable problem
// (unknown reference airport, malformed cell) is skipped and reported, the rest of the file still
// loads. Values FR24 encodes that don't fit our schema are never guessed at — dropped to null and
// counted in the summary (see D37 in WORKBOOK.md §16). id/seq/created_at/fm_no/fm_id are not set by
// this importer (regenerated or left null — FR24 rows have no migration number, see D39).
import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "../server/db.js";
import { haversineKm, durationMinutes } from "../server/lib/geo.js";
import { parseFr24Csv, mapRow } from "./lib/fr24.js";
import { validateRow, formatIssuesTable, type RowIssue } from "./lib/validate.js";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const file = process.argv.slice(2).find((a) => a !== "--force" && a !== "--dry-run");
if (!file) {
  console.error("usage: npm run import:fr24 -- <file.csv> [--force] [--dry-run]");
  process.exit(1);
}

const text = fs.readFileSync(file, "utf8");
const fr24Rows = parseFr24Csv(text); // throws a clear message on header mismatch
if (fr24Rows.length === 0) {
  throw new Error(`no data rows found in ${file}`);
}

type AirportRef = { iata: string; city: string | null; country: string | null; name: string; lat: number | null; lon: number | null; tz: string | null };
const airportStmt = db.prepare(
  "SELECT iata, city, country, name, lat, lon, tz FROM airports WHERE iata = ?",
);

const OFFSET_CANDIDATES = [0, 1, 2, -1];

/** D37/[C2] offset resolution: try each candidate day-offset, keep it only if exactly one produces a
 * TZ/DST-aware duration within 5 minutes of what the CSV itself reported. */
function resolveOffset(
  date: string,
  depTime: string,
  depTz: string,
  arrTime: string,
  arrTz: string,
  csvDurationMin: number,
): { offset: number; resolved: boolean } {
  const matches = OFFSET_CANDIDATES.filter((offset) => {
    const computed = durationMinutes(date, depTime, depTz, arrTime, arrTz, offset);
    return computed != null && Math.abs(computed - csvDurationMin) <= 5;
  });
  return matches.length === 1 ? { offset: matches[0], resolved: true } : { offset: 0, resolved: false };
}

const ready: Record<string, unknown>[] = [];
const skipped: RowIssue[] = []; // blocking issues -> row excluded from import
const offsetNotes: { line: number; route: string }[] = []; // informational only -> row still imported
let crewPromoted = 0;
let otherDropped = 0;

fr24Rows.forEach((fr24Row, i) => {
  const line = i + 2; // header is CSV line 1
  const mapped = mapRow(fr24Row, line);
  if (mapped.crewPromoted) crewPromoted++;
  if (mapped.droppedReason === "other") otherDropped++;

  const blocking: RowIssue[] = [...mapped.issues];

  const depIata = mapped.row.dep_iata;
  const arrIata = mapped.row.arr_iata;
  const dep = depIata ? (airportStmt.get(depIata) as AirportRef | undefined) : undefined;
  const arr = arrIata ? (airportStmt.get(arrIata) as AirportRef | undefined) : undefined;
  if (depIata && !dep) {
    blocking.push({
      row: line, field: "dep_iata", value: depIata,
      problem: "not found in reference airports table — add the airport to the reference data and re-run",
    });
  }
  if (arrIata && !arr) {
    blocking.push({
      row: line, field: "arr_iata", value: arrIata,
      problem: "not found in reference airports table — add the airport to the reference data and re-run",
    });
  }

  // D37/[C2]: "unresolved" covers every reason a unique offset couldn't be pinned down — missing
  // times/duration included ("시각 결측 포함" in the spec), not just an ambiguous/no match among the
  // four candidates. All of those fall out of offsetResolved staying false below.
  const { date, dep_time: depTime, arr_time: arrTime, duration_min: csvDuration } = mapped.row;
  let offset = 0;
  let offsetResolved = false;
  if (date && dep?.tz && arr?.tz && depTime && arrTime && csvDuration != null) {
    const result = resolveOffset(date, depTime, dep.tz, arrTime, arr.tz, csvDuration);
    offset = result.offset;
    offsetResolved = result.resolved;
  }

  const finalRow: Record<string, unknown> = {
    fm_no: null, fm_id: null,
    date,
    dep_time: depTime, arr_time: arrTime,
    arr_day_offset: offset,
    dep_iata: depIata,
    // Reference-DB values win over the CSV's own city text, which we never even read (D37 spec).
    dep_city: dep?.city ?? null, dep_country: dep?.country ?? null, dep_airport_name: dep?.name ?? null,
    arr_iata: arrIata,
    arr_city: arr?.city ?? null, arr_country: arr?.country ?? null, arr_airport_name: arr?.name ?? null,
    distance_km:
      dep?.lat != null && dep?.lon != null && arr?.lat != null && arr?.lon != null
        ? Math.round(haversineKm(dep.lat, dep.lon, arr.lat, arr.lon))
        : null,
    duration_min: csvDuration,
    airline: mapped.row.airline,
    flight_no: mapped.row.flight_no,
    aircraft_type: mapped.row.aircraft_type,
    aircraft_reg: mapped.row.aircraft_reg,
    aircraft_name: null, // FR24 has no separate nickname field distinct from aircraft type
    seat: mapped.row.seat,
    seat_pos: mapped.row.seat_pos,
    travel_class: mapped.row.travel_class,
    flight_role: mapped.row.flight_role,
    flight_reason: mapped.row.flight_reason,
    comment: mapped.row.comment,
  };

  if (blocking.length === 0) {
    // Final shared safety net (also used by import-json.ts) — should normally find nothing new here,
    // since every field above was already produced/validated by mapRow + the lookups above.
    blocking.push(...validateRow(finalRow, line));
  }

  if (blocking.length > 0) {
    skipped.push(...blocking);
  } else {
    ready.push(finalRow);
    // Only report "unresolved" for rows that actually get imported — a row already excluded above
    // (e.g. unknown airport) is reported once, in the skip table, not a second time here.
    if (!offsetResolved) offsetNotes.push({ line, route: `${depIata ?? "?"}-${arrIata ?? "?"}` });
  }
});

// ---------- report ----------

const dates = (ready as { date: string }[]).map((r) => r.date).sort();
console.log(`FR24 import: ${file}`);
console.log(`  total rows:        ${fr24Rows.length}`);
console.log(`  ${dryRun ? "would load" : "loaded"}:         ${ready.length}`);
console.log(`  skipped (error):   ${new Set(skipped.map((s) => s.row)).size}`);
console.log(`  crew promoted:     ${crewPromoted} (Flight reason=3 -> flight_role='crew')`);
console.log(`  reason "other" dropped: ${otherDropped} (Flight reason=4 -> flight_reason=null)`);
console.log(`  offset unresolved: ${offsetNotes.length} (defaulted to 0 — see below)`);
console.log(`  date range:        ${dates.length ? `${dates[0]} .. ${dates[dates.length - 1]}` : "n/a"}`);

if (skipped.length > 0) {
  console.log(`\nRows skipped (not imported):`);
  console.log(formatIssuesTable(skipped));
}
if (offsetNotes.length > 0) {
  console.log(`\nArrival-day offset unresolved (row still imported with arr_day_offset=0 — verify by hand):`);
  console.table(offsetNotes);
}

if (ready.length === 0) {
  console.error(`\nnothing importable — 0 of ${fr24Rows.length} rows could be mapped`);
  process.exit(1);
}

if (dryRun) {
  console.log(`\n--dry-run: no changes made.`);
  process.exit(skipped.length > 0 ? 1 : 0);
}

// D40: same initial-load-only guard as import-json.ts/migrate.ts.
const total = (db.prepare("SELECT COUNT(*) AS n FROM flights").get() as { n: number }).n;
if (total > 0) {
  if (!force) {
    throw new Error(
      `refusing to import: flights table already has ${total} rows. ` +
        `Importing replaces everything. If that is what you want, run \`npm run import:fr24 -- ${file} --force\` ` +
        `(a JSON backup of the current table is written to data/backups/ first).`,
    );
  }
  const dumpRows = db.prepare("SELECT * FROM flights ORDER BY date, id").all();
  const backupsDir = path.join(path.dirname(DB_PATH), "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const dumpPath = path.join(backupsDir, `pre-import-fr24-${ts}.json`);
  fs.writeFileSync(
    dumpPath,
    JSON.stringify({ dumpedAt: new Date().toISOString(), reason: "pre-import-fr24 --force", flights: dumpRows }, null, 2),
  );
  console.log(`--force: dumped ${total} existing rows to ${dumpPath}, replacing them now`);
}

const FIELDS = [
  "fm_no", "fm_id", "date", "dep_time", "arr_time", "arr_day_offset",
  "dep_iata", "dep_city", "dep_country", "dep_airport_name",
  "arr_iata", "arr_city", "arr_country", "arr_airport_name",
  "distance_km", "duration_min", "airline", "flight_no",
  "aircraft_type", "aircraft_reg", "aircraft_name", "seat", "seat_pos",
  "travel_class", "flight_role", "flight_reason", "comment",
] as const;
const cols = FIELDS.join(", ");
const params = FIELDS.map((k) => `@${k}`).join(", ");
const insert = db.prepare(`INSERT INTO flights (${cols}) VALUES (${params})`);
db.transaction(() => {
  db.prepare("DELETE FROM flights").run();
  for (const row of ready) insert.run(row);
})();

console.log(`\nimported ${ready.length} flights from ${file}`);
