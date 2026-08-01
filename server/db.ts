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

CREATE TABLE IF NOT EXISTS flights (
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
  travel_class     TEXT CHECK (travel_class IN ('economy','economyplus','business','first') OR travel_class IS NULL),
  flight_role      TEXT NOT NULL DEFAULT 'passenger' CHECK (flight_role IN ('passenger','crew','cockpit')),
  flight_reason    TEXT CHECK (flight_reason IN ('personal','business','virtual') OR flight_reason IS NULL),
  comment          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(date);
CREATE INDEX IF NOT EXISTS idx_flights_route ON flights(dep_iata, arr_iata);
`);
