// OpenFlights 스냅샷(data/reference/airlines.dat) → airlines 테이블 적재.
// IATA 2자리 코드가 있는 항공사만. 코드 중복 시 운항 중(active=Y) 우선.
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR } from "../server/db.js";

const SRC = path.join(DATA_DIR, "reference", "airlines.dat");

// airlines.dat: id,name,alias,iata,icao,callsign,country,active — 따옴표 포함 CSV, 빈 값은 \N
function parseLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out.map((f) => (f === "\\N" ? "" : f));
}

const insert = db.prepare(
  "INSERT OR REPLACE INTO airlines (iata, icao, name, country, active) VALUES (?, ?, ?, ?, ?)",
);

const best = new Map<string, { name: string; icao: string; country: string; active: boolean }>();
for (const line of fs.readFileSync(SRC, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const [, name, , iata, icao, , country, activeFlag] = parseLine(line);
  const code = iata?.trim().toUpperCase();
  if (!/^[0-9A-Z]{2}$/.test(code ?? "") || !name?.trim()) continue;
  const active = activeFlag === "Y";
  const prev = best.get(code!);
  // 운항 중인 항공사 우선, 동급이면 먼저 나온 것 유지
  if (!prev || (active && !prev.active)) {
    best.set(code!, { name: name.trim(), icao: icao ?? "", country: country ?? "", active });
  }
}

// 사용자 이력의 표기를 참조DB보다 우선한다 (기존 108편과 자동완성 표기 일치 — WORKBOOK D5 취지)
const historical = db
  .prepare("SELECT airline, flight_no, COUNT(*) AS n FROM flights WHERE airline IS NOT NULL AND flight_no IS NOT NULL GROUP BY airline, flight_no")
  .all() as { airline: string; flight_no: string; n: number }[];
const historicalByCode = new Map<string, { name: string; n: number }>();
for (const row of historical) {
  const m = /^([0-9A-Z]{2})\s*\d/i.exec(row.flight_no.trim());
  if (!m) continue;
  const code = m[1].toUpperCase();
  const prev = historicalByCode.get(code);
  if (!prev || row.n > prev.n) historicalByCode.set(code, { name: row.airline, n: row.n });
}

let overridden = 0;
db.transaction(() => {
  for (const [code, a] of best) {
    const hist = historicalByCode.get(code);
    const renamed = hist != null && hist.name !== a.name;
    if (renamed) overridden++;
    // 이름을 내 이력으로 덮어쓴 경우 참조DB의 국가·ICAO는 다른 항공사의 것일 수 있어 버린다
    insert.run(
      code,
      renamed ? null : a.icao || null,
      hist?.name ?? a.name,
      renamed ? null : a.country || null,
      a.active ? 1 : 0,
    );
  }
  // 참조DB에 없지만 내 이력에는 있는 코드 보강
  for (const [code, hist] of historicalByCode) {
    if (!best.has(code)) {
      insert.run(code, null, hist.name, null, 1);
      overridden++;
    }
  }
})();

const total = db.prepare("SELECT COUNT(*) AS n FROM airlines").get() as { n: number };
console.log(`seeded ${total.n} airlines (${overridden} names overridden by existing flight history)`);
console.table(
  db.prepare("SELECT iata, name, country FROM airlines WHERE iata IN ('KE','OZ','JL','TG','AA','7C','BX','RS') ORDER BY iata").all(),
);
