import { db } from "../db.js";
import { classifyFlight, type FlightScope } from "./geo.js";

export const EARTH_CIRCUM_KM = 40075;
export const MOON_DIST_KM = 384400;
export const SUN_DIST_KM = 149597870;
export const KM_TO_MI = 0.621371;

type Row = Record<string, any>;

const airportStmt = () => db.prepare("SELECT iata, city, country, country_code, continent, lat, lon FROM airports WHERE iata = ?");

// 연번(seq)은 이관 여부와 무관하게 전체 비행에 날짜순으로 매긴다.
// 이관 원본의 번호(fm_no)도 날짜순이라 이관분은 기존 번호를 그대로 유지하고,
// 새로 입력한 비행이 그 뒤를 이어받는다. 연도 필터를 걸어도 seq는 전체 기준.
const SEQ_SELECT = `
  SELECT ROW_NUMBER() OVER (ORDER BY date, COALESCE(dep_time,'00:00'), id) AS seq, *
  FROM flights
`;

export function flightsForYear(year: string | null): Row[] {
  if (year && /^\d{4}$/.test(year)) {
    return db
      .prepare(`SELECT * FROM (${SEQ_SELECT}) WHERE substr(date,1,4) = ? ORDER BY seq`)
      .all(year) as Row[];
  }
  return db.prepare(`SELECT * FROM (${SEQ_SELECT}) ORDER BY seq`).all() as Row[];
}

export function flightById(id: number): Row | undefined {
  return db.prepare(`SELECT * FROM (${SEQ_SELECT}) WHERE id = ?`).get(id) as Row | undefined;
}

export function computeStats(year: string | null) {
  const flights = flightsForYear(year);
  const lookup = airportStmt();
  const km = flights.reduce((s, f) => s + (f.distance_km ?? 0), 0);
  const min = flights.reduce((s, f) => s + (f.duration_min ?? 0), 0);

  const scope: Record<FlightScope | "unknown", number> = { domestic: 0, intra: 0, inter: 0, unknown: 0 };
  for (const f of flights) {
    const dep = lookup.get(f.dep_iata) as Row | undefined;
    const arr = lookup.get(f.arr_iata) as Row | undefined;
    const c = dep && arr ? classifyFlight(dep as any, arr as any) : null;
    scope[c ?? "unknown"]++;
  }

  const summary = (f: Row) => ({
    seq: f.seq, fm_no: f.fm_no, id: f.id, date: f.date,
    dep: f.dep_iata, arr: f.arr_iata,
    depCity: f.dep_city, arrCity: f.arr_city,
    km: f.distance_km, min: f.duration_min,
  });
  const withDist = flights.filter((f) => f.distance_km != null);
  const withDur = flights.filter((f) => f.duration_min != null);
  const withSpeed = flights.filter((f) => f.distance_km != null && f.duration_min != null && f.duration_min > 0);
  const speedOf = (f: Row) => f.distance_km / (f.duration_min / 60);
  const maxBy = (rows: Row[], fn: (f: Row) => number) => rows.length ? rows.reduce((a, b) => (fn(b) > fn(a) ? b : a)) : null;
  const minBy = (rows: Row[], fn: (f: Row) => number) => rows.length ? rows.reduce((a, b) => (fn(b) < fn(a) ? b : a)) : null;

  const longestKm = maxBy(withDist, (f) => f.distance_km);
  const longestMin = maxBy(withDur, (f) => f.duration_min);
  const shortestKm = minBy(withDist, (f) => f.distance_km);
  const shortestMin = minBy(withDur, (f) => f.duration_min);
  const fastest = maxBy(withSpeed, speedOf);
  const slowest = minBy(withSpeed, speedOf);

  const count = (items: (string | null)[]) => {
    const c = new Map<string, number>();
    for (const i of items) if (i) c.set(i, (c.get(i) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const routes = count(flights.map((f) => `${f.dep_iata}-${f.arr_iata}`));
  const airports = count(flights.flatMap((f) => [f.dep_iata, f.arr_iata]));
  const airportCity = new Map<string, string>();
  for (const f of flights) {
    if (!airportCity.has(f.dep_iata) && f.dep_city) airportCity.set(f.dep_iata, f.dep_city);
    if (!airportCity.has(f.arr_iata) && f.arr_city) airportCity.set(f.arr_iata, f.arr_city);
  }

  const distOf = (key: string, vals: string[]) => {
    const out: Record<string, number> = {};
    for (const v of vals) out[v] = flights.filter((f) => f[key] === v).length;
    out.none = flights.filter((f) => f[key] == null).length;
    return out;
  };

  const perYear = db
    .prepare(
      `SELECT substr(date,1,4) AS year, COUNT(*) AS flights,
              COALESCE(SUM(distance_km),0) AS km, COALESCE(SUM(duration_min),0) AS min
       FROM flights GROUP BY year ORDER BY year`,
    )
    .all();

  return {
    year: year ?? "all",
    totals: {
      flights: flights.length,
      km,
      mi: Math.round(km * KM_TO_MI),
      min,
      earthCircum: km / EARTH_CIRCUM_KM,
      moonDist: km / MOON_DIST_KM,
      sunDist: km / SUN_DIST_KM,
    },
    scope,
    records: {
      longestKm: longestKm && summary(longestKm),
      longestMin: longestMin && summary(longestMin),
      shortestKm: shortestKm && summary(shortestKm),
      shortestMin: shortestMin && summary(shortestMin),
      fastest: fastest && { ...summary(fastest), kmh: Math.round(speedOf(fastest)) },
      slowest: slowest && { ...summary(slowest), kmh: Math.round(speedOf(slowest)) },
      avgKm: flights.length ? Math.round(km / flights.length) : 0,
      avgMin: flights.length ? Math.floor(min / flights.length) : 0,
    },
    topRoutes: routes.slice(0, 10),
    topAirports: airports.slice(0, 10).map(([iata, n]) => [iata, n, airportCity.get(iata) ?? null]),
    topAirlines: count(flights.map((f) => f.airline)).slice(0, 10),
    topAircraft: count(flights.map((f) => f.aircraft_type)).slice(0, 10),
    distinct: {
      airports: new Set(flights.flatMap((f) => [f.dep_iata, f.arr_iata])).size,
      airlines: new Set(flights.map((f) => f.airline).filter(Boolean)).size,
      aircraftTypes: new Set(flights.map((f) => f.aircraft_type).filter(Boolean)).size,
      registrations: new Set(flights.map((f) => f.aircraft_reg).filter(Boolean)).size,
      routes: routes.length,
      countries: new Set(flights.flatMap((f) => [f.dep_country, f.arr_country]).filter(Boolean)).size,
    },
    classes: distOf("travel_class", ["economy", "economyplus", "business", "first", "private"]),
    seatPos: distOf("seat_pos", ["window", "middle", "aisle"]),
    roles: distOf("flight_role", ["passenger", "crew", "cockpit"]),
    reasons: distOf("flight_reason", ["personal", "business", "virtual"]),
    perYear,
  };
}

export function computeMap(year: string | null) {
  const flights = flightsForYear(year);
  const lookup = airportStmt();
  const points = new Map<string, { iata: string; city: string | null; lat: number; lon: number; count: number }>();
  const arcs = new Map<string, { from: string; to: string; count: number }>();
  for (const f of flights) {
    for (const iata of [f.dep_iata, f.arr_iata]) {
      if (!points.has(iata)) {
        const a = lookup.get(iata) as Row | undefined;
        if (a?.lat != null && a?.lon != null) {
          points.set(iata, { iata, city: (a.city as string) ?? null, lat: a.lat, lon: a.lon, count: 0 });
        }
      }
      const p = points.get(iata);
      if (p) p.count++;
    }
    const key = [f.dep_iata, f.arr_iata].sort().join("-");
    const arc = arcs.get(key);
    if (arc) arc.count++;
    else {
      const [from, to] = [f.dep_iata, f.arr_iata].sort();
      arcs.set(key, { from, to, count: 1 });
    }
  }
  return { airports: [...points.values()], arcs: [...arcs.values()] };
}
