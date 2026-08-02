// Migration cross-check: DB aggregates vs anchors.json (numbers you recorded from your previous
// flight-log system's statistics page — see anchors.example.json for how to fill it in).
//
// [C2-a] (WORKBOOK §16) exit codes: 0 = every check passed, 1 = a real mismatch (an anchor and the DB
// disagree), 2 = verify could not run at all (missing/incomplete config, or nothing to compare yet).
// 0/1 come from the PASS/FAIL tally at the very bottom; every early-exit below this point uses 2, so a
// "config not ready" run is never confused with a "your migration is corrupted" run.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../server/db.js";
import { classifyFlight } from "../server/lib/geo.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANCHORS_PATH = path.join(HERE, "anchors.json");

if (!fs.existsSync(ANCHORS_PATH)) {
  console.error("migration/anchors.json not found.\n");
  console.error("Copy migration/anchors.example.json to migration/anchors.json and fill in the numbers");
  console.error("from your previous system's statistics page (the example file documents what each field");
  console.error("means), then run `npm run verify` again.");
  process.exit(2);
}

let anchors: Record<string, any>;
try {
  anchors = JSON.parse(fs.readFileSync(ANCHORS_PATH, "utf8"));
} catch (e) {
  console.error(`migration/anchors.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

// Every key verify.ts reads from anchors, dotted for nested paths. Kept in one place so a partially
// filled-in anchors.json (e.g. only half the example was copied over) is reported by field name instead
// of surfacing later as either a silent "expected: undefined" FAIL or a TypeError from a nested access
// on a missing "records"/"distinct" object.
const REQUIRED_ANCHOR_KEYS = [
  "totalFlights", "totalKm", "totalMin",
  "scope.domestic", "scope.intra", "scope.inter",
  "records.longestKm", "records.longestMin", "records.shortestKm", "records.shortestMin",
  "records.fastestKmh", "records.slowestKmh", "records.avgKm", "records.avgMin",
  "topRoutes", "topAirports", "topAirlines", "topAircraft",
  "distinct.airports", "distinct.airlines", "distinct.aircraftTypes",
  "distinct.registrations", "distinct.routes", "distinct.countries",
  "classes", "seatPos", "roles", "reasons",
];
function readAnchorPath(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}
const missingAnchorKeys = REQUIRED_ANCHOR_KEYS.filter((k) => readAnchorPath(anchors, k) === undefined);
if (missingAnchorKeys.length > 0) {
  console.error(`migration/anchors.json is missing ${missingAnchorKeys.length} required key(s):\n`);
  for (const k of missingAnchorKeys) console.error(`  - ${k}`);
  console.error(`\nSee migration/anchors.example.json for the full shape.`);
  process.exit(2);
}

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}\n     expected: ${e}\n     actual:   ${a}`);
  }
}

type Row = Record<string, any>;
// D39: migration-integrity check normally compares only rows that came from an old system (fm_no set) —
// flights added directly in the app have nothing to do with the anchor snapshot (D16). But an importer
// that has no concept of a migration number (e.g. import-fr24.ts) never sets fm_no at all, so if there
// are zero fm_no rows, compare against every row instead — otherwise verify would have nothing to check
// against for anyone who didn't migrate from the fm_no-numbered system. Either way, this is the one
// place that decides what "the migrated data" means for every check below.
const migratedCount = (db.prepare("SELECT COUNT(*) AS n FROM flights WHERE fm_no IS NOT NULL").get() as { n: number }).n;
const usingAllRows = migratedCount === 0;
const flights = usingAllRows
  ? (db.prepare("SELECT * FROM flights ORDER BY date, id").all() as Row[])
  : (db.prepare("SELECT * FROM flights WHERE fm_no IS NOT NULL ORDER BY fm_no").all() as Row[]);

if (usingAllRows) {
  if (flights.length > 0) {
    console.log(`ℹ comparing against ALL rows (no migration-numbered rows found) — ${flights.length} row(s)\n`);
  }
} else {
  const ownCount = (db.prepare("SELECT COUNT(*) AS n FROM flights WHERE fm_no IS NULL").get() as { n: number }).n;
  if (ownCount > 0) {
    console.log(`ℹ ${ownCount} flight(s) added directly in the app are excluded (comparing ${flights.length} migrated rows only)\n`);
  }
}

// [C2-a]: with zero rows to compare, every check below would either trivially "pass" against expected
// non-zero anchors (misleading) or — for the five reduce()-based record checks — throw
// "Reduce of empty array with no initial value". Stop early with a clear reason instead.
if (flights.length === 0) {
  console.error(
    "0 rows to verify — run this right after an import (npm run import:json -- ... or " +
      "npm run import:fr24 -- ...) so there is data in the database to check against your anchors.",
  );
  process.exit(2);
}

// Migrated rows edited by a human after import — informational only, never affects PASS/FAIL.
const editedRows = db
  .prepare("SELECT fm_no, updated_at FROM flights WHERE fm_no IS NOT NULL AND updated_at IS NOT NULL ORDER BY fm_no")
  .all() as { fm_no: number; updated_at: string }[];
if (editedRows.length > 0) {
  const shown = editedRows.slice(0, 10).map((r) => `#${r.fm_no}(${r.updated_at.slice(0, 16)})`).join(", ");
  const extra = editedRows.length > 10 ? ` and ${editedRows.length - 10} more` : "";
  console.log(`ℹ ${editedRows.length} migrated row(s) were edited by hand: ${shown}${extra}`);
  console.log("  (if an edit touched an anchored value like distance or duration, a FAIL below may be an intended edit, not corruption)\n");
}

console.log("== Totals ==");
check("total flights", flights.length, anchors.totalFlights);
check("total distance (km)", flights.reduce((s, f) => s + (f.distance_km ?? 0), 0), anchors.totalKm);
check("total duration (min)", flights.reduce((s, f) => s + (f.duration_min ?? 0), 0), anchors.totalMin);

console.log("== Classification ==");
const airport = db.prepare("SELECT country_code, continent FROM airports WHERE iata = ?");
const scope = { domestic: 0, intra: 0, inter: 0, unknown: 0 };
for (const f of flights) {
  const dep = airport.get(f.dep_iata) as Row | undefined;
  const arr = airport.get(f.arr_iata) as Row | undefined;
  const c = dep && arr ? classifyFlight(dep as any, arr as any) : null;
  if (c) scope[c]++;
  else scope.unknown++;
}
check("domestic/intra/inter", { domestic: scope.domestic, intra: scope.intra, inter: scope.inter }, anchors.scope);
check("no unclassifiable flights", scope.unknown, 0);

console.log("== Records ==");
const withDist = flights.filter((f) => f.distance_km != null);
const withDur = flights.filter((f) => f.duration_min != null);
const routeOf = (f: Row) => `${f.dep_iata}-${f.arr_iata}`;
// [C2-a]: initial-value-safe reduce (mirrors the maxBy/minBy helpers in server/lib/stats.ts). The
// flights.length===0 guard above covers the common trigger ("0 rows to verify"), but withDist/withDur/
// speeds are narrower subsets — e.g. every migrated row missing distance_km — that could in principle
// still be empty on their own; these now report as a normal FAIL against the anchor instead of throwing
// "Reduce of empty array with no initial value".
const maxBy = <T,>(rows: T[], fn: (r: T) => number): T | null => (rows.length ? rows.reduce((a, b) => (fn(b) > fn(a) ? b : a)) : null);
const minBy = <T,>(rows: T[], fn: (r: T) => number): T | null => (rows.length ? rows.reduce((a, b) => (fn(b) < fn(a) ? b : a)) : null);
const maxKm = maxBy(withDist, (f) => f.distance_km);
const maxMin = maxBy(withDur, (f) => f.duration_min);
const minKm = minBy(withDist, (f) => f.distance_km);
const minMin = minBy(withDur, (f) => f.duration_min);
check("longest distance", maxKm && { route: routeOf(maxKm), km: maxKm.distance_km }, anchors.records.longestKm);
check("longest duration", maxMin && { route: routeOf(maxMin), min: maxMin.duration_min }, anchors.records.longestMin);
check("shortest distance", minKm && { route: routeOf(minKm), km: minKm.distance_km }, anchors.records.shortestKm);
check("shortest duration", minMin && { route: routeOf(minMin), min: minMin.duration_min }, anchors.records.shortestMin);
const speeds = flights
  .filter((f) => f.distance_km != null && f.duration_min != null && f.duration_min > 0)
  .map((f) => ({ route: routeOf(f), kmh: Math.round(f.distance_km / (f.duration_min / 60)) }));
const fastest = maxBy(speeds, (s) => s.kmh);
const slowest = minBy(speeds, (s) => s.kmh);
check("fastest", fastest, anchors.records.fastestKmh);
check("slowest", slowest, anchors.records.slowestKmh);
check("average distance (km)", Math.round(flights.reduce((s, f) => s + (f.distance_km ?? 0), 0) / flights.length), anchors.records.avgKm);
check("average duration (min, floor)", Math.floor(flights.reduce((s, f) => s + (f.duration_min ?? 0), 0) / flights.length), anchors.records.avgMin);

console.log("== Top N (tie order differs by system — only per-entry counts and the count sequence are compared) ==");
function countMap(items: (string | null)[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const i of items) if (i) c.set(i, (c.get(i) ?? 0) + 1);
  return c;
}
// (a) every anchor entry's count matches ours (b) the sorted top-N count sequence matches
function checkTop(name: string, items: (string | null)[], anchor: [string, number][]) {
  const c = countMap(items);
  const mismatches = anchor
    .filter(([k, v]) => c.get(k) !== v)
    .map(([k, v]) => `${k}: expected ${v}, actual ${c.get(k) ?? 0}`);
  const ourSeq = [...c.values()].sort((a, b) => b - a).slice(0, anchor.length);
  const anchorSeq = anchor.map(([, v]) => v);
  check(name, { entryMismatches: mismatches, countSeq: ourSeq }, { entryMismatches: [], countSeq: anchorSeq });
}
checkTop("top routes (directional)", flights.map(routeOf), anchors.topRoutes);
checkTop("top airports", flights.flatMap((f) => [f.dep_iata, f.arr_iata]), anchors.topAirports);
checkTop("top airlines", flights.map((f) => f.airline), anchors.topAirlines);
checkTop("top aircraft", flights.map((f) => f.aircraft_type), anchors.topAircraft);

console.log("== Distinct counts & distributions ==");
const uniq = (xs: (string | null)[]) => new Set(xs.filter(Boolean)).size;
check("airports", uniq(flights.flatMap((f) => [f.dep_iata, f.arr_iata])), anchors.distinct.airports);
check("airlines", uniq(flights.map((f) => f.airline)), anchors.distinct.airlines);
check("aircraft types", uniq(flights.map((f) => f.aircraft_type)), anchors.distinct.aircraftTypes);
check("registrations", uniq(flights.map((f) => f.aircraft_reg)), anchors.distinct.registrations);
check("routes", uniq(flights.map(routeOf)), anchors.distinct.routes);
check("countries (as written in source data)", uniq(flights.flatMap((f) => [f.dep_country, f.arr_country])), anchors.distinct.countries);

const dist = (key: string, vals: string[]) => {
  const out: Record<string, number> = {};
  for (const v of vals) out[v] = flights.filter((f) => f[key] === v).length;
  out.none = flights.filter((f) => f[key] == null).length;
  return out;
};
// D37 어휘 확장분(private/crew/cockpit/virtual)은 **카운트가 0이면 키 자체를 내보내지 않는다** —
// check()가 JSON 문자열 엄격 비교라 무조건 키를 추가하면 확장 전에 쓰인 anchors 파일이 전부 깨진다.
// 값이 실제로 존재하는 DB에서만 키가 나타나고, 그 사용자는 anchors에도 같은 키를 적게 된다.
const withNonZero = (base: Record<string, number>, key: string, count: number) => {
  const out = { ...base };
  if (count > 0) {
    const none = out.none;
    delete out.none;
    out[key] = count;
    if (none !== undefined) out.none = none; // none은 항상 마지막 자리 유지 (기존 출력 순서 보존)
  }
  return out;
};
check(
  "class distribution",
  withNonZero(dist("travel_class", ["economy", "economyplus", "business", "first"]), "private", flights.filter((f) => f.travel_class === "private").length),
  anchors.classes,
);
check("seat position distribution", dist("seat_pos", ["window", "middle", "aisle"]), anchors.seatPos);
let roles: Record<string, number> = { passenger: flights.filter((f) => f.flight_role === "passenger").length };
roles = withNonZero(roles, "crew", flights.filter((f) => f.flight_role === "crew").length);
roles = withNonZero(roles, "cockpit", flights.filter((f) => f.flight_role === "cockpit").length);
check("role distribution", roles, anchors.roles);
check(
  "reason distribution",
  withNonZero(
    { personal: flights.filter((f) => f.flight_reason === "personal").length, business: flights.filter((f) => f.flight_reason === "business").length },
    "virtual",
    flights.filter((f) => f.flight_reason === "virtual").length,
  ),
  anchors.reasons,
);

console.log("== Per-row integrity ==");
// D39 all-rows 모드에선 fm_no가 없다 — 행 라벨은 fm_no 우선, 없으면 DB id로 폴백(#null 방지).
const rowLabel = (f: Row) => (f.fm_no != null ? `${f.fm_no}` : `id${f.id}`);
const missingRef = flights.filter((f) => !airport.get(f.dep_iata) || !airport.get(f.arr_iata));
check("no airports missing from the reference DB", missingRef.map(rowLabel), []);
const noDist = flights.filter((f) => f.distance_km == null || f.duration_min == null);
check("no missing distance/duration", noDist.map(rowLabel), []);
const weirdOffsets = flights.filter((f) => Math.abs(f.arr_day_offset) > 2);
if (weirdOffsets.length) {
  console.log(`  ⚠ unusual arrival-day offsets, kept as-is (${weirdOffsets.length}): ` + weirdOffsets.map((f) => `#${rowLabel(f)}(${f.arr_day_offset})`).join(", "));
}
const comments = flights.filter((f) => f.comment != null);
console.log(`  ℹ ${comments.length} comment(s): ` + comments.map((f) => `#${rowLabel(f)}"${f.comment}"`).join(", "));

console.log(`\nResult: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
