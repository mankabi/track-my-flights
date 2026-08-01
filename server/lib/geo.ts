const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export type FlightScope = "domestic" | "intra" | "inter";

// D11: 같은 나라=국내, 같은 대륙=대륙내, 그 외=대륙간 (출발지↔도착지 비교)
export function classifyFlight(
  dep: { country_code: string | null; continent: string | null },
  arr: { country_code: string | null; continent: string | null },
): FlightScope | null {
  if (!dep.country_code || !arr.country_code) return null;
  if (dep.country_code === arr.country_code) return "domestic";
  if (dep.continent && arr.continent && dep.continent === arr.continent) return "intra";
  return "inter";
}

// 소요시간(분): 공항 로컬시각 + IANA tz 기준. DST를 포함해 UTC로 환산해 차를 구한다.
export function durationMinutes(
  date: string,
  depTime: string,
  depTz: string,
  arrTime: string,
  arrTz: string,
  arrDayOffset: number,
): number | null {
  const dep = zonedEpochMinutes(date, depTime, depTz);
  const arrDate = addDays(date, arrDayOffset);
  const arr = zonedEpochMinutes(arrDate, arrTime, arrTz);
  if (dep == null || arr == null) return null;
  return arr - dep;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "로컬시각이 tz에서 가리키는 순간"의 epoch(분). Intl로 역산(±1일 탐색, 분 단위 정밀도).
function zonedEpochMinutes(isoDate: string, hhmm: string, tz: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const [, h, min] = m;
  const targetUtcGuess = Date.parse(`${isoDate}T${h.padStart(2, "0")}:${min}:00Z`);
  if (Number.isNaN(targetUtcGuess)) return null;
  for (const offsetMin of candidateOffsets(tz, targetUtcGuess)) {
    const epoch = targetUtcGuess - offsetMin * 60_000;
    if (wallClockAt(epoch, tz) === `${isoDate} ${h.padStart(2, "0")}:${min}`) {
      return Math.round(epoch / 60_000);
    }
  }
  return Math.round(targetUtcGuess / 60_000);
}

function candidateOffsets(tz: string, aroundEpoch: number): number[] {
  const offsets = new Set<number>();
  for (const deltaH of [0, -24, 24, -12, 12]) {
    offsets.add(tzOffsetMinutes(tz, aroundEpoch + deltaH * 3_600_000));
  }
  return [...offsets];
}

function tzOffsetMinutes(tz: string, epoch: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(epoch);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function wallClockAt(epoch: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(epoch);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
}
