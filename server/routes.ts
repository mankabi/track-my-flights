import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { haversineKm, durationMinutes } from "./lib/geo.js";
import { normalizeFlightNo } from "./lib/flightno.js";
import { computeStats, computeMap, flightsForYear, flightById } from "./lib/stats.js";

// index.ts/db.ts와 같은 방식으로 ROOT 계산 (server/ 바로 아래 파일이므로 부모가 리포 루트).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };

export const apiRouter = Router();

// v1.4(D30): 에러 응답을 { error: { code, params? } }로 통일. 한국어 문자열 대신 코드+파라미터를 보내고
// 클라이언트(web/src/lib/api.ts)가 errors.<code> 카탈로그로 번역한다. CLI(migration/verify)는 이번 스코프 밖.
type ApiError = { code: string; params?: Record<string, string> };
function errorBody(code: string, params?: Record<string, string>): { error: ApiError } {
  return { error: params ? { code, params } : { code } };
}

apiRouter.get("/health", (_req, res) => {
  const total = (db.prepare("SELECT COUNT(*) AS n FROM flights").get() as { n: number }).n;
  const migrated = (db.prepare("SELECT COUNT(*) AS n FROM flights WHERE fm_no IS NOT NULL").get() as { n: number }).n;
  res.json({
    ok: true,
    now: new Date().toISOString(),
    version: pkg.version,
    flights: { total, migrated },
  });
});

// ---------- airports ----------

// 공항 코드·도시명·공항명 검색. 내가 가본 공항을 위로, 그다음 코드 정확일치 → 접두일치 순.
apiRouter.get("/airports/search", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const prefix = `${q}%`;
  const rows = db
    .prepare(
      `SELECT a.iata, a.name, a.city, a.country, a.country_code, a.continent, a.lat, a.lon, a.tz,
              COALESCE(u.n, 0) AS used
       FROM airports a
       LEFT JOIN (
         SELECT iata, SUM(n) AS n FROM (
           SELECT dep_iata AS iata, COUNT(*) AS n FROM flights GROUP BY dep_iata
           UNION ALL
           SELECT arr_iata AS iata, COUNT(*) AS n FROM flights GROUP BY arr_iata
         ) GROUP BY iata
       ) u ON u.iata = a.iata
       WHERE a.iata = ? OR a.city LIKE ? OR a.name LIKE ? OR a.iata LIKE ?
       ORDER BY used DESC,
                (a.iata = ?) DESC,
                (a.city LIKE ?) DESC,
                (a.name LIKE ?) DESC,
                a.city
       LIMIT 12`,
    )
    .all(q.toUpperCase(), like, like, prefix.toUpperCase(), q.toUpperCase(), prefix, prefix);
  res.json(rows);
});

apiRouter.get("/airports/:iata", (req, res) => {
  const row = db
    .prepare("SELECT * FROM airports WHERE iata = ?")
    .get(String(req.params.iata).toUpperCase());
  if (!row) return res.status(404).json(errorBody("not_found"));
  res.json(row);
});

// ---------- airlines ----------

// 항공사명 또는 IATA 2자리 코드로 검색. 내 이력에 있는 항공사를 항상 위로.
apiRouter.get("/airlines/search", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT a.iata, a.name, a.country,
              COALESCE(h.n, 0) AS used
       FROM airlines a
       LEFT JOIN (SELECT airline, COUNT(*) AS n FROM flights WHERE airline IS NOT NULL GROUP BY airline) h
         ON h.airline = a.name
       WHERE a.iata = ? OR a.name LIKE ?
       ORDER BY used DESC, (a.iata = ?) DESC, a.active DESC, a.name
       LIMIT 12`,
    )
    .all(q.toUpperCase(), like, q.toUpperCase());
  res.json(rows);
});

// ---------- flights CRUD ----------

const FLIGHT_FIELDS = [
  "date", "dep_time", "arr_time", "arr_day_offset",
  "dep_iata", "dep_city", "dep_country", "dep_airport_name",
  "arr_iata", "arr_city", "arr_country", "arr_airport_name",
  "distance_km", "duration_min", "airline", "flight_no",
  "aircraft_type", "aircraft_reg", "aircraft_name", "seat", "seat_pos",
  "travel_class", "flight_role", "flight_reason", "comment",
] as const;

function normalizeFlightBody(
  body: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; code: string; params?: Record<string, string> } {
  const data: Record<string, unknown> = {};
  for (const k of FLIGHT_FIELDS) {
    let v = body[k];
    if (typeof v === "string") v = v.trim() || null;
    data[k] = v ?? null;
  }
  if (typeof data.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    return { ok: false, code: "date_format" };
  }
  const parsed = new Date(`${data.date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== data.date) {
    return { ok: false, code: "date_invalid" };
  }
  for (const k of ["dep_iata", "arr_iata"] as const) {
    if (typeof data[k] !== "string" || !/^[A-Za-z]{3}$/.test(data[k] as string)) {
      return { ok: false, code: "iata_format", params: { field: k } };
    }
    data[k] = (data[k] as string).toUpperCase();
  }
  for (const k of ["dep_time", "arr_time"] as const) {
    if (data[k] != null && !/^\d{2}:\d{2}$/.test(data[k] as string)) {
      return { ok: false, code: "time_format", params: { field: k } };
    }
  }
  data.arr_day_offset = data.arr_day_offset == null ? 0 : Number(data.arr_day_offset);
  if (!Number.isInteger(data.arr_day_offset)) return { ok: false, code: "offset_integer" };
  for (const k of ["distance_km", "duration_min"] as const) {
    if (data[k] != null) {
      data[k] = Number(data[k]);
      if (!Number.isFinite(data[k] as number)) return { ok: false, code: "number_format", params: { field: k } };
      data[k] = Math.round(data[k] as number);
    }
  }
  data.flight_role = data.flight_role ?? "passenger";
  // 항공사를 IATA 코드로 입력하면 참조DB의 정식 명칭으로 정규화한다.
  // "KE"와 "Korean Air"가 별개 항공사로 집계되면 항공사 수·Top 목록이 쪼개진다(D13 표기 일관성).
  if (typeof data.airline === "string" && /^[0-9A-Za-z]{2}$/.test(data.airline)) {
    const al = db.prepare("SELECT name FROM airlines WHERE iata = ?").get(data.airline.toUpperCase()) as
      | { name: string }
      | undefined;
    if (al) data.airline = al.name;
  }
  // D24: 편명 정규화 + 항공사 교차검증.
  // 1) 입력된 항공사명을 참조DB에서 역으로 IATA 코드로 해석 (편명 코드와 비교하기 위해).
  let airlineIata: string | null = null;
  if (typeof data.airline === "string") {
    const al = db.prepare("SELECT iata FROM airlines WHERE name = ? COLLATE NOCASE").get(data.airline) as
      | { iata: string }
      | undefined;
    airlineIata = al?.iata ?? null;
  }
  if (typeof data.flight_no === "string" && data.flight_no) {
    const fn = normalizeFlightNo(data.flight_no, airlineIata);
    if (!fn.ok) return { ok: false, code: fn.code, params: fn.params };
    data.flight_no = fn.value || null;
    if (fn.code) {
      const byCode = db.prepare("SELECT name, iata FROM airlines WHERE iata = ?").get(fn.code) as
        | { name: string; iata: string }
        | undefined;
      if (byCode) {
        if (data.airline) {
          // 편명에서 해석된 항공사 코드와, 입력한 항공사명이 가리키는 코드가 서로 다르면 저장 차단.
          // 이름 문자열을 직접 비교하지 않고 코드로 비교해 대소문자·표기 차이(예: "JEJU AIR" vs "Jeju Air")를
          // 오탐하지 않는다 — 참조DB에 없는 항공사(airlineIata=null)는 비교 불가하므로 통과시킨다.
          if (airlineIata && airlineIata.toUpperCase() !== byCode.iata.toUpperCase()) {
            return {
              ok: false,
              code: "flightno_airline_mismatch",
              params: { flightNo: fn.value, flightNoAirline: byCode.name, inputAirline: String(data.airline) },
            };
          }
        } else {
          data.airline = byCode.name;
        }
      }
    }
  }
  // 도시·국가·공항명이 비어 있으면 참조DB로 채움 (이관 데이터는 원본 표기 보존 — D5)
  for (const side of ["dep", "arr"] as const) {
    if (!data[`${side}_city`] && !data[`${side}_country`] && !data[`${side}_airport_name`]) {
      const a = db.prepare("SELECT name, city, country FROM airports WHERE iata = ?").get(data[`${side}_iata`]) as
        | { name: string; city: string | null; country: string | null }
        | undefined;
      if (a) {
        data[`${side}_city`] = a.city;
        data[`${side}_country`] = a.country;
        data[`${side}_airport_name`] = a.name;
      }
    }
  }
  return { ok: true, data };
}

apiRouter.get("/flights", (req, res) => {
  const year = req.query.year ? String(req.query.year) : null;
  const rows = flightsForYear(year && year !== "all" ? year : null);
  rows.reverse(); // 최신 먼저
  res.json(rows);
});

apiRouter.get("/flights/:id", (req, res) => {
  const row = flightById(Number(req.params.id));
  if (!row) return res.status(404).json(errorBody("not_found"));
  res.json(row);
});

apiRouter.post("/flights", (req, res) => {
  const r = normalizeFlightBody(req.body ?? {});
  if (!r.ok) return res.status(400).json(errorBody(r.code, r.params));
  const cols = FLIGHT_FIELDS.join(", ");
  const params = FLIGHT_FIELDS.map((k) => `@${k}`).join(", ");
  const info = db.prepare(`INSERT INTO flights (${cols}) VALUES (${params})`).run(r.data);
  const row = flightById(Number(info.lastInsertRowid));
  res.status(201).json(row);
});

apiRouter.put("/flights/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM flights WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json(errorBody("not_found"));
  const body = (req.body ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...existing, ...body };
  // IATA를 실제로 바꾼 쪽만: body에 없는 도시·국가·공항명을 리셋해서 normalizeFlightBody의
  // 참조DB 자동 채움(미해석이면 null)이 다시 뛰게 한다. 안 그러면 예전 도시가 잔존한다.
  for (const side of ["dep", "arr"] as const) {
    const newIata = body[`${side}_iata`];
    if (typeof newIata === "string" && newIata.trim().toUpperCase() !== String(existing[`${side}_iata`]).toUpperCase()) {
      for (const sub of ["city", "country", "airport_name"] as const) {
        const key = `${side}_${sub}`;
        if (!(key in body)) merged[key] = null;
      }
    }
  }
  const r = normalizeFlightBody(merged);
  if (!r.ok) return res.status(400).json(errorBody(r.code, r.params));
  const sets = FLIGHT_FIELDS.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE flights SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run({ ...r.data, id });
  res.json(flightById(id));
});

apiRouter.delete("/flights/:id", (req, res) => {
  const info = db.prepare("DELETE FROM flights WHERE id = ?").run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json(errorBody("not_found"));
  res.json({ ok: true });
});

// ---------- 자동계산·자동완성 ----------

apiRouter.get("/estimate", (req, res) => {
  const dep = db.prepare("SELECT * FROM airports WHERE iata = ?").get(String(req.query.dep ?? "").toUpperCase()) as Record<string, any> | undefined;
  const arr = db.prepare("SELECT * FROM airports WHERE iata = ?").get(String(req.query.arr ?? "").toUpperCase()) as Record<string, any> | undefined;
  if (!dep || !arr) return res.status(404).json(errorBody("airport_not_found"));
  let distance_km: number | null = null;
  if (dep.lat != null && arr.lat != null) {
    distance_km = Math.round(haversineKm(dep.lat, dep.lon, arr.lat, arr.lon));
  }
  let duration_min: number | null = null;
  const date = String(req.query.date ?? "");
  const depTime = String(req.query.dep_time ?? "");
  const arrTime = String(req.query.arr_time ?? "");
  const offset = Number(req.query.offset ?? 0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(depTime) && /^\d{2}:\d{2}$/.test(arrTime) && dep.tz && arr.tz) {
    duration_min = durationMinutes(date, depTime, dep.tz, arrTime, arr.tz, Number.isInteger(offset) ? offset : 0);
    if (duration_min != null && duration_min <= 0) duration_min = null;
  }
  res.json({ distance_km, duration_min, dep, arr });
});

apiRouter.get("/suggest", (_req, res) => {
  const q = (col: string) =>
    db.prepare(`SELECT ${col} AS v, COUNT(*) AS n FROM flights WHERE ${col} IS NOT NULL GROUP BY ${col} ORDER BY n DESC, v`).all();
  res.json({
    airlines: q("airline"),
    aircraftTypes: q("aircraft_type"),
    registrations: q("aircraft_reg"),
  });
});

// ---------- 통계·지도 ----------

apiRouter.get("/stats", (req, res) => {
  const year = req.query.year ? String(req.query.year) : null;
  res.json(computeStats(year && year !== "all" ? year : null));
});

apiRouter.get("/map", (req, res) => {
  const year = req.query.year ? String(req.query.year) : null;
  res.json(computeMap(year && year !== "all" ? year : null));
});

// ---------- 내보내기 (백업 — §3) ----------

apiRouter.get("/export/json", (_req, res) => {
  const rows = flightsForYear(null);
  res.setHeader("Content-Disposition", `attachment; filename="track-my-flights-${today()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), flights: rows });
});

apiRouter.get("/export/csv", (_req, res) => {
  const rows = flightsForYear(null) as Record<string, unknown>[];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v: unknown) => {
    if (v == null) return "";
    let s = String(v);
    // CSV 수식 인젝션 가드: =/+/-/@/TAB/CR로 시작하면 프리픽스. 단 순수 숫자(음수 오프셋 등)는 예외.
    if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) {
      s = `'${s}`;
    }
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="track-my-flights-${today()}.csv"`);
  res.send("﻿" + csv);
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
