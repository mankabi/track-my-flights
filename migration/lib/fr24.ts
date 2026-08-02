// [C2] FR24 (MyFlightRadar24) CSV importer — pure parsing/mapping functions (WORKBOOK §16, D37).
// No DB / better-sqlite3 import here: airport-reference lookups, great-circle distance, and
// arr_day_offset resolution all need the DB (airports table + server/lib/geo.ts) and live in
// migration/import-fr24.ts instead. Everything in this file is a plain function so it is unit-testable
// without a database.
//
// Value-mapping policy (D37, "미해석 값 정책"): unknown/unmapped codes are never guessed at — they
// become null and the caller (import-fr24.ts) counts and reports them. This file never invents data.
import type { RowIssue } from "./validate.js";

// ---------- CSV parsing (RFC4180-ish: quoted fields, embedded commas/newlines, CRLF or LF) ----------

/** Minimal hand-rolled CSV parser — quoted fields (with "" escaping), commas/newlines inside quotes, CRLF. */
export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------- header + row shape ----------

export const FR24_HEADER = [
  "Date", "Flight number", "From", "To", "Dep time", "Arr time", "Duration", "Airline", "Aircraft",
  "Registration", "Seat number", "Seat type", "Flight class", "Flight reason", "Note",
  "Dep_id", "Arr_id", "Airline_id", "Aircraft_id",
] as const;

export type Fr24Row = Record<(typeof FR24_HEADER)[number], string>;

export function parseFr24Csv(text: string): Fr24Row[] {
  const table = parseCsvTable(text);
  if (table.length === 0) return [];
  const header = table[0];
  const mismatch =
    header.length !== FR24_HEADER.length || FR24_HEADER.some((h, i) => header[i] !== h);
  if (mismatch) {
    throw new Error(
      `unexpected FR24 CSV header — expected exactly:\n  ${FR24_HEADER.join(",")}\ngot:\n  ${header.join(",")}`,
    );
  }
  return table.slice(1).map((cells) => {
    const obj = {} as Record<string, string>;
    FR24_HEADER.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj as Fr24Row;
  });
}

// ---------- cell parsers ----------

// "Seoul (GMP/RKSS)" -> { city: "Seoul", iata: "GMP" }. FR24 writes "City (IATA/ICAO)"; we only keep
// IATA. Any deviation from that exact shape (missing parens, non-3-letter first code, ...) -> null.
const AIRPORT_CELL_RE = /^(.+) \(([A-Za-z]{3})\/[A-Za-z0-9]{3,4}\)$/;
export function parseAirportCell(cell: string): { city: string; iata: string } | null {
  const m = AIRPORT_CELL_RE.exec(cell.trim());
  if (!m) return null;
  return { city: m[1].trim(), iata: m[2].toUpperCase() };
}

// "Korean Air (KE/KAL)" -> { name: "Korean Air", iata: "KE" }. No parens -> whole string is the name
// (iata null). DB storage uses the name (D13 convention); iata is only for flight-no cross-checks.
const AIRLINE_CELL_RE = /^(.+) \(([A-Za-z0-9]{2})\/[A-Za-z0-9]{2,4}\)$/;
export function parseAirlineCell(cell: string): { name: string; iata: string | null } {
  const trimmed = cell.trim();
  const m = AIRLINE_CELL_RE.exec(trimmed);
  if (!m) return { name: trimmed, iata: null };
  return { name: m[1].trim(), iata: m[2].toUpperCase() };
}

// "Airbus A330-300 (A333)" -> "Airbus A330-300". No parens -> original string unchanged.
const AIRCRAFT_CELL_RE = /^(.+) \([A-Za-z0-9]+\)$/;
export function parseAircraftCell(cell: string): string {
  const trimmed = cell.trim();
  const m = AIRCRAFT_CELL_RE.exec(trimmed);
  return m ? m[1].trim() : trimmed;
}

// HH:MM:SS -> HH:MM (seconds truncated); HH:MM stays; empty -> null. Non-empty-but-unparseable also
// -> null (caller decides whether that's worth an issue — it always has the raw cell to compare).
export function parseFr24Time(cell: string): string | null {
  const v = cell.trim();
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// "HH:MM:SS" -> whole minutes (rounded). Empty -> null.
export function parseFr24Duration(cell: string): number | null {
  const v = cell.trim();
  if (!v) return null;
  const m = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(m[3]) / 60);
}

// Date cell -> YYYY-MM-DD strictly. Three independent sources agree on the format: FR24's own
// CSV-upload docs ("2010-04-16", https://support.fr24.com/support/solutions/articles/3000115530),
// and the two reference importers (one parses with Python's date.fromisoformat, the other with an
// ISO-only regex — supervisor cross-checked both). A DD-MM-YYYY fallback was considered and
// REJECTED: no evidence FR24 ever emits it, and it is indistinguishable from MM-DD locales
// (05-04-2024 → silent misparse). Policy: never guess — unknown formats return null and the
// caller reports the row instead of importing a wrong date.
export function parseFr24Date(cell: string): string | null {
  const v = cell.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}

// ---------- D37 value mapping ----------

export type SeatPos = "window" | "middle" | "aisle";
export function mapSeatType(v: string): SeatPos | null {
  switch (v.trim()) {
    case "1":
      return "window";
    case "2":
      return "middle";
    case "3":
      return "aisle";
    default:
      return null;
  }
}

export type TravelClass = "economy" | "business" | "first" | "economyplus" | "private";
export function mapFlightClass(v: string): TravelClass | null {
  switch (v.trim()) {
    case "1":
      return "economy";
    case "2":
      return "business";
    case "3":
      return "first";
    case "4":
      return "economyplus";
    case "5":
      return "private";
    default:
      return null;
  }
}

export interface ReasonMapping {
  flightReason: "personal" | "business" | null;
  flightRole?: "crew";
  dropped?: "other";
}

// FR24 conflates "why did I fly" and "in what capacity" into one field. Codes 1/2 map straight across.
// Code 3 (crew) is really an answer to a different question in our schema -> flight_role, reason null.
// Code 4 (other) has no equivalent in our vocabulary -> dropped to null + reported (never guessed at).
export function mapFlightReason(v: string): ReasonMapping {
  switch (v.trim()) {
    case "1":
      return { flightReason: "personal" };
    case "2":
      return { flightReason: "business" };
    case "3":
      return { flightReason: null, flightRole: "crew" };
    case "4":
      return { flightReason: null, dropped: "other" };
    default:
      return { flightReason: null };
  }
}

// ---------- row mapping ----------

export interface MappedFr24Row {
  date: string | null;
  dep_time: string | null;
  arr_time: string | null;
  dep_iata: string | null;
  arr_iata: string | null;
  duration_min: number | null;
  airline: string | null;
  flight_no: string | null;
  aircraft_type: string | null;
  aircraft_reg: string | null;
  seat: string | null;
  seat_pos: SeatPos | null;
  travel_class: TravelClass | null;
  flight_role: "passenger" | "crew";
  flight_reason: "personal" | "business" | null;
  comment: string | null;
}

export interface MapRowResult {
  row: MappedFr24Row;
  issues: RowIssue[];
  droppedReason?: "other";
  crewPromoted?: boolean;
}

/**
 * Map one FR24 CSV row into our schema's field names (still missing dep/arr city·country·airport_name,
 * distance_km, and a resolved arr_day_offset — those need the airports table + geo.ts and are filled in
 * by migration/import-fr24.ts). `line` is the CSV line number (header = line 1) used in reported issues.
 */
export function mapRow(fr24: Fr24Row, line: number): MapRowResult {
  const issues: RowIssue[] = [];
  const add = (field: string, value: unknown, problem: string) => issues.push({ row: line, field, value, problem });

  const date = parseFr24Date(fr24.Date);
  if (!date) add("date", fr24.Date, "could not parse date (expected YYYY-MM-DD)");

  const dep = parseAirportCell(fr24.From);
  if (!dep) add("dep_iata", fr24.From, 'could not parse airport cell (expected "City (IATA/ICAO)")');
  const arr = parseAirportCell(fr24.To);
  if (!arr) add("arr_iata", fr24.To, 'could not parse airport cell (expected "City (IATA/ICAO)")');

  const depTimeRaw = fr24["Dep time"];
  const depTime = parseFr24Time(depTimeRaw);
  if (depTimeRaw.trim() && depTime == null) {
    add("dep_time", depTimeRaw, "could not parse time (expected HH:MM or HH:MM:SS)");
  }
  const arrTimeRaw = fr24["Arr time"];
  const arrTime = parseFr24Time(arrTimeRaw);
  if (arrTimeRaw.trim() && arrTime == null) {
    add("arr_time", arrTimeRaw, "could not parse time (expected HH:MM or HH:MM:SS)");
  }

  const durationRaw = fr24.Duration;
  const durationMin = parseFr24Duration(durationRaw);
  if (durationRaw.trim() && durationMin == null) {
    add("duration_min", durationRaw, "could not parse duration (expected HH:MM:SS)");
  }

  const airlineCell = fr24.Airline.trim();
  const airline = airlineCell ? parseAirlineCell(airlineCell).name : null;

  const aircraftCell = fr24.Aircraft.trim();
  const aircraftType = aircraftCell ? parseAircraftCell(aircraftCell) : null;

  const seatPos = mapSeatType(fr24["Seat type"]);
  const travelClass = mapFlightClass(fr24["Flight class"]);
  const reasonMapping = mapFlightReason(fr24["Flight reason"]);

  const row: MappedFr24Row = {
    date,
    dep_time: depTime,
    arr_time: arrTime,
    dep_iata: dep?.iata ?? null,
    arr_iata: arr?.iata ?? null,
    duration_min: durationMin,
    airline,
    // Flight number is kept verbatim (whitespace trimmed only) — D24-style normalization is for the
    // app's own input path; an importer preserves the source's original text.
    flight_no: fr24["Flight number"].trim() || null,
    aircraft_type: aircraftType,
    aircraft_reg: fr24.Registration.trim() || null,
    seat: fr24["Seat number"].trim() || null,
    seat_pos: seatPos,
    travel_class: travelClass,
    flight_role: reasonMapping.flightRole ?? "passenger",
    flight_reason: reasonMapping.flightReason,
    comment: fr24.Note.trim() || null,
  };

  return {
    row,
    issues,
    droppedReason: reasonMapping.dropped,
    crewPromoted: reasonMapping.flightRole === "crew" ? true : undefined,
  };
}
