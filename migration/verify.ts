// Migration cross-check: DB aggregates vs anchors.json (numbers you recorded from your previous
// flight-log system's statistics page — see anchors.example.json for how to fill it in).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../server/db.js";
import { classifyFlight } from "../server/lib/geo.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const anchors = JSON.parse(fs.readFileSync(path.join(HERE, "anchors.json"), "utf8"));

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
// Migration-integrity check: only rows that came from the old system (fm_no set) are compared.
// Flights added directly in the app have nothing to do with the anchor snapshot.
const flights = db.prepare("SELECT * FROM flights WHERE fm_no IS NOT NULL ORDER BY fm_no").all() as Row[];
const ownCount = (db.prepare("SELECT COUNT(*) AS n FROM flights WHERE fm_no IS NULL").get() as { n: number }).n;
if (ownCount > 0) {
  console.log(`ℹ ${ownCount} flight(s) added directly in the app are excluded (comparing ${flights.length} migrated rows only)\n`);
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
const maxKm = withDist.reduce((a, b) => (b.distance_km > a.distance_km ? b : a));
const maxMin = withDur.reduce((a, b) => (b.duration_min > a.duration_min ? b : a));
const minKm = withDist.reduce((a, b) => (b.distance_km < a.distance_km ? b : a));
const minMin = withDur.reduce((a, b) => (b.duration_min < a.duration_min ? b : a));
check("longest distance", { route: routeOf(maxKm), km: maxKm.distance_km }, anchors.records.longestKm);
check("longest duration", { route: routeOf(maxMin), min: maxMin.duration_min }, anchors.records.longestMin);
check("shortest distance", { route: routeOf(minKm), km: minKm.distance_km }, anchors.records.shortestKm);
check("shortest duration", { route: routeOf(minMin), min: minMin.duration_min }, anchors.records.shortestMin);
const speeds = flights
  .filter((f) => f.distance_km != null && f.duration_min != null && f.duration_min > 0)
  .map((f) => ({ route: routeOf(f), kmh: Math.round(f.distance_km / (f.duration_min / 60)) }));
const fastest = speeds.reduce((a, b) => (b.kmh > a.kmh ? b : a));
const slowest = speeds.reduce((a, b) => (b.kmh < a.kmh ? b : a));
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
check("class distribution", dist("travel_class", ["economy", "economyplus", "business", "first"]), anchors.classes);
check("seat position distribution", dist("seat_pos", ["window", "middle", "aisle"]), anchors.seatPos);
check("role distribution", { passenger: flights.filter((f) => f.flight_role === "passenger").length }, anchors.roles);
check(
  "reason distribution",
  { personal: flights.filter((f) => f.flight_reason === "personal").length, business: flights.filter((f) => f.flight_reason === "business").length },
  anchors.reasons,
);

console.log("== Per-row integrity ==");
const missingRef = flights.filter((f) => !airport.get(f.dep_iata) || !airport.get(f.arr_iata));
check("no airports missing from the reference DB", missingRef.map((f) => f.fm_no), []);
const noDist = flights.filter((f) => f.distance_km == null || f.duration_min == null);
check("no missing distance/duration", noDist.map((f) => f.fm_no), []);
const weirdOffsets = flights.filter((f) => Math.abs(f.arr_day_offset) > 2);
if (weirdOffsets.length) {
  console.log(`  ⚠ unusual arrival-day offsets, kept as-is (${weirdOffsets.length}): ` + weirdOffsets.map((f) => `#${f.fm_no}(${f.arr_day_offset})`).join(", "));
}
const comments = flights.filter((f) => f.comment != null);
console.log(`  ℹ ${comments.length} comment(s): ` + comments.map((f) => `#${f.fm_no}"${f.comment}"`).join(", "));

console.log(`\nResult: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
