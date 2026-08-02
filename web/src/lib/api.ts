// API 래퍼 + 타입 정의. 서버 계약: server/routes.ts 참조.

import { translateError } from "../i18n";

export type SeatPos = "window" | "aisle" | "middle";
export type TravelClass = "economy" | "economyplus" | "business" | "first" | "private";
export type FlightRole = "passenger" | "crew" | "cockpit";
export type FlightReason = "personal" | "business" | "virtual";

export interface Flight {
  id: number;
  /** 날짜순 연번(1..N). 서버가 조회 시 계산하며 이관분·신규 입력분을 통틀어 매긴다. */
  seq: number;
  /** FM 이관 원본 번호. 신규 입력분은 null (이관 무결성 검증용) */
  fm_no: number | null;
  fm_id: number | null;
  date: string; // YYYY-MM-DD
  dep_time: string | null; // HH:MM
  arr_time: string | null;
  arr_day_offset: number;
  dep_iata: string;
  dep_city: string | null;
  dep_country: string | null;
  dep_airport_name: string | null;
  arr_iata: string;
  arr_city: string | null;
  arr_country: string | null;
  arr_airport_name: string | null;
  distance_km: number | null;
  duration_min: number | null;
  airline: string | null;
  flight_no: string | null;
  aircraft_type: string | null;
  aircraft_reg: string | null;
  aircraft_name: string | null;
  seat: string | null;
  seat_pos: SeatPos | null;
  travel_class: TravelClass | null;
  flight_role: FlightRole;
  flight_reason: FlightReason | null;
  comment: string | null;
  created_at: string;
  updated_at: string | null;
}

export type FlightInput = Partial<
  Omit<Flight, "id" | "seq" | "fm_no" | "fm_id" | "created_at" | "updated_at">
>;

export interface Airport {
  iata: string;
  name: string;
  city: string | null;
  country: string | null;
  country_code: string | null;
  continent: string | null;
  lat: number | null;
  lon: number | null;
  tz: string | null;
  used: number;
}

export interface EstimateResult {
  distance_km: number | null;
  duration_min: number | null;
  dep: Airport;
  arr: Airport;
}

export interface Airline {
  iata: string;
  name: string;
  country: string | null;
  used: number;
}

export interface SuggestItem {
  v: string;
  n: number;
}

export interface SuggestResult {
  airlines: SuggestItem[];
  aircraftTypes: SuggestItem[];
  registrations: SuggestItem[];
}

export interface FlightSummary {
  seq: number;
  fm_no: number | null;
  id: number;
  date: string;
  dep: string;
  arr: string;
  depCity: string | null;
  arrCity: string | null;
  km: number | null;
  min: number | null;
}

export interface SpeedSummary extends FlightSummary {
  kmh: number;
}

export interface StatsResult {
  year: string;
  totals: {
    flights: number;
    km: number;
    mi: number;
    min: number;
    earthCircum: number;
    moonDist: number;
    sunDist: number;
  };
  scope: { domestic: number; intra: number; inter: number; unknown: number };
  records: {
    longestKm: FlightSummary | null;
    longestMin: FlightSummary | null;
    shortestKm: FlightSummary | null;
    shortestMin: FlightSummary | null;
    fastest: SpeedSummary | null;
    slowest: SpeedSummary | null;
    avgKm: number;
    avgMin: number;
  };
  topRoutes: [string, number][];
  topAirports: [string, number, string | null][];
  topAirlines: [string, number][];
  topAircraft: [string, number][];
  distinct: {
    airports: number;
    airlines: number;
    aircraftTypes: number;
    registrations: number;
    routes: number;
    countries: number;
  };
  classes: Record<string, number>;
  seatPos: Record<string, number>;
  roles: Record<string, number>;
  reasons: Record<string, number>;
  perYear: { year: string; flights: number; km: number; min: number }[];
}

export interface MapAirport {
  iata: string;
  city: string | null;
  lat: number;
  lon: number;
  count: number;
}

export interface MapArc {
  from: string;
  to: string;
  count: number;
}

export interface MapResult {
  airports: MapAirport[];
  arcs: MapArc[];
}

export interface HealthResult {
  ok: boolean;
  now: string;
  version: string;
  flights: { total: number; migrated: number };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      // 신형(D30): { error: { code, params? } } — errors.<code> 카탈로그로 번역, 미등록 코드는 코드 문자열 그대로.
      // 구형 방어: error가 평문 문자열이면 그대로 사용 (놓친 엔드포인트가 있어도 안전하게 표시).
      if (body?.error && typeof body.error === "object" && typeof body.error.code === "string") {
        message = translateError(body.error.code, body.error.params);
      } else if (typeof body?.error === "string") {
        message = body.error;
      }
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  flights: {
    list: (year?: string | null) =>
      request<Flight[]>(`/flights${year && year !== "all" ? `?year=${year}` : ""}`),
    create: (data: FlightInput) =>
      request<Flight>("/flights", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: FlightInput) =>
      request<Flight>(`/flights/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: number) =>
      request<{ ok: true }>(`/flights/${id}`, { method: "DELETE" }),
  },
  airports: {
    search: (q: string) =>
      request<Airport[]>(`/airports/search?q=${encodeURIComponent(q)}`),
  },
  airlines: {
    search: (q: string) =>
      request<Airline[]>(`/airlines/search?q=${encodeURIComponent(q)}`),
  },
  estimate: (params: {
    dep: string;
    arr: string;
    date?: string;
    dep_time?: string;
    arr_time?: string;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set("dep", params.dep);
    qs.set("arr", params.arr);
    if (params.date) qs.set("date", params.date);
    if (params.dep_time) qs.set("dep_time", params.dep_time);
    if (params.arr_time) qs.set("arr_time", params.arr_time);
    if (params.offset != null) qs.set("offset", String(params.offset));
    return request<EstimateResult>(`/estimate?${qs.toString()}`);
  },
  suggest: () => request<SuggestResult>("/suggest"),
  stats: (year?: string | null) =>
    request<StatsResult>(`/stats${year && year !== "all" ? `?year=${year}` : ""}`),
  map: (year?: string | null) =>
    request<MapResult>(`/map${year && year !== "all" ? `?year=${year}` : ""}`),
  health: () => request<HealthResult>("/health"),
};

export async function getFlightById(id: number): Promise<Flight | null> {
  try {
    return await request<Flight>(`/flights/${id}`);
  } catch {
    return null;
  }
}
