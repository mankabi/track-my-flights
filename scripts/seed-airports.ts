// OurAirports 스냅샷(data/reference/*.csv) → airports 테이블 적재.
// IATA 3글자 코드가 있는 공항만. tz는 좌표 기반(tz-lookup) 산출.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tzlookup from "tz-lookup";
import { db, DATA_DIR } from "../server/db.js";

const REF = path.join(DATA_DIR, "reference");

function parseCsv(text: string): string[][] {
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

const countriesCsv = parseCsv(fs.readFileSync(path.join(REF, "countries.csv"), "utf8"));
const cHeader = countriesCsv[0];
const cCode = cHeader.indexOf("code");
const cName = cHeader.indexOf("name");
const countryName = new Map<string, string>();
for (const r of countriesCsv.slice(1)) countryName.set(r[cCode], r[cName]);

const airportsCsv = parseCsv(fs.readFileSync(path.join(REF, "airports.csv"), "utf8"));
const h = airportsCsv[0];
const col = (name: string) => {
  const i = h.indexOf(name);
  if (i < 0) throw new Error(`missing column: ${name}`);
  return i;
};
const iIata = col("iata_code");
const iIcao = col("ident");
const iName = col("name");
const iCity = col("municipality");
const iCountry = col("iso_country");
const iContinent = col("continent");
const iLat = col("latitude_deg");
const iLon = col("longitude_deg");
const iType = col("type");

const insert = db.prepare(
  `INSERT OR REPLACE INTO airports (iata, icao, name, city, country, country_code, continent, lat, lon, tz)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const typeRank: Record<string, number> = {
  large_airport: 3,
  medium_airport: 2,
  small_airport: 1,
};

const best = new Map<string, { rank: number; row: string[] }>();
for (const r of airportsCsv.slice(1)) {
  const iata = r[iIata]?.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata ?? "")) continue;
  const rank = typeRank[r[iType]] ?? 0;
  if (rank === 0) continue;
  const prev = best.get(iata!);
  if (!prev || rank > prev.rank) best.set(iata!, { rank, row: r });
}

let n = 0;
db.transaction(() => {
  for (const [iata, { row: r }] of best) {
    const lat = Number(r[iLat]);
    const lon = Number(r[iLon]);
    let tz: string | null = null;
    try {
      tz = tzlookup(lat, lon);
    } catch {
      tz = null;
    }
    insert.run(
      iata,
      r[iIcao] || null,
      r[iName],
      r[iCity] || null,
      countryName.get(r[iCountry]) ?? r[iCountry],
      r[iCountry] || null,
      r[iContinent] || null,
      Number.isFinite(lat) ? lat : null,
      Number.isFinite(lon) ? lon : null,
      tz,
    );
    n++;
  }
})();

console.log(`seeded ${n} airports`);
const check = db.prepare("SELECT iata, city, country, continent, tz FROM airports WHERE iata IN ('GMP','ICN','HND','SPN','LGA') ORDER BY iata").all();
console.table(check);
