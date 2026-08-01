// 화면에 닿는 숫자·날짜 포맷은 전부 이 파일을 통과한다 (반올림/고정소수, 문자열 날짜 비교 — CLAUDE.md 참조).
// v1.4: lang을 받아 Intl 기반으로 로케일 표기한다 (D29) — 이 파일은 훅을 쓸 수 없으므로 호출부(컴포넌트)가
// useI18n()에서 얻은 lang을 매번 넘긴다. 라벨 딕셔너리(좌석·클래스 등)는 ../i18n의 모듈 수준 t()로 위임.

import { t, type Lang, type MsgKey } from "../i18n";

const DATE_LOCALE: Record<Lang, string> = { ko: "ko-KR", en: "en-US" };

/** 오늘 날짜를 로컬 기준 "YYYY-MM-DD"로. new Date(iso)의 UTC 해석 함정을 피한다. */
export function todayStr(): string {
  return new Date().toLocaleDateString("sv");
}

/** "YYYY-MM-DD" -> ko: "2026. 07. 31.", en: "Jul 31, 2026" (Intl.DateTimeFormat, UTC 고정 — 로컬 타임존 함정 회피) */
export function formatDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  const options: Intl.DateTimeFormatOptions =
    lang === "ko"
      ? { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }
      : { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], options).format(date);
}

/** "YYYY-MM-DD" -> ko: "2026. 07. 31. (금)", en: "Jul 31, 2026 (Fri)" */
export function formatDateWithWeekday(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat(DATE_LOCALE[lang], { weekday: "short", timeZone: "UTC" }).format(date);
  return `${formatDate(iso, lang)} (${weekday})`;
}

/** 분 -> "H:MM" (시가 두 자리 넘어도 그대로, 분은 2자리 패딩) */
export function formatDuration(min: number | null | undefined): string {
  if (min == null) return "-";
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

const NUM_LOCALE: Record<Lang, string> = { ko: "ko-KR", en: "en-US" };

/** km -> "1,773" 형태의 숫자만, 로케일 자릿수 구분 (단위는 호출부에서) */
export function formatKm(km: number | null | undefined, lang: Lang): string {
  if (km == null) return "-";
  return Math.round(km).toLocaleString(NUM_LOCALE[lang]);
}

export function formatNumber(n: number | null | undefined, lang: Lang): string {
  if (n == null) return "-";
  return n.toLocaleString(NUM_LOCALE[lang]);
}

export function formatFixed(n: number | null | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

export function formatPercent(part: number, total: number, digits = 1): string {
  if (!total) return "0.0";
  return ((part / total) * 100).toFixed(digits);
}

/** "H:MM" 텍스트 입력 -> 분(정수). 형식이 아니면 null. */
export function parseDurationToMinutes(text: string): number | null {
  const m = /^(\d{1,4}):([0-5]?\d)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** arr_day_offset -> "+1" 같은 위첨자 표기 (0이면 빈 문자열) */
export function formatDayOffset(offset: number): string {
  if (!offset) return "";
  return offset > 0 ? `+${offset}` : `${offset}`;
}

/** "YYYY-MM-DD" + n일 -> "YYYY-MM-DD". UTC 고정 (server geo.ts의 addDays와 동일 로직 — 로컬 타임존 함정 회피). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 두 "YYYY-MM-DD" 사이의 일수 차 (a - b). UTC 고정. */
export function diffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((da - db) / 86_400_000);
}

// 라벨 딕셔너리는 ../i18n의 common.* 카탈로그로 위임 (모듈 수준 t() — 이 파일은 훅을 못 쓴다).
// 카탈로그 키가 없는 값(v)은 그대로 보여준다 — 참조DB에 없는 자유 입력 등 예상 밖 값을 지우지 않기 위해.
const SEAT_POS_KEY: Record<string, MsgKey> = {
  window: "common.seatWindow",
  aisle: "common.seatAisle",
  middle: "common.seatMiddle",
};
export function seatPosLabel(v: string | null): string {
  if (!v) return "-";
  const key = SEAT_POS_KEY[v];
  return key ? t(key) : v;
}

const TRAVEL_CLASS_KEY: Record<string, MsgKey> = {
  economy: "common.classEconomy",
  economyplus: "common.classEconomyPlus",
  business: "common.classBusiness",
  first: "common.classFirst",
};
export function travelClassLabel(v: string | null): string {
  if (!v) return "-";
  const key = TRAVEL_CLASS_KEY[v];
  return key ? t(key) : v;
}

// 클래스 배지(Y/Y+/C/F)는 항공권 관례 약어라 언어 무관 유지.
const TRAVEL_CLASS_BADGE: Record<string, string> = {
  economy: "Y",
  economyplus: "Y+",
  business: "C",
  first: "F",
};
export function travelClassBadge(v: string | null): string {
  return v ? (TRAVEL_CLASS_BADGE[v] ?? v) : "-";
}

const FLIGHT_ROLE_KEY: Record<string, MsgKey> = {
  passenger: "common.rolePassenger",
  crew: "common.roleCrew",
  cockpit: "common.roleCockpit",
};
export function flightRoleLabel(v: string | null): string {
  if (!v) return "-";
  const key = FLIGHT_ROLE_KEY[v];
  return key ? t(key) : v;
}

const FLIGHT_REASON_KEY: Record<string, MsgKey> = {
  personal: "common.reasonPersonal",
  business: "common.reasonBusiness",
  virtual: "common.reasonVirtual",
};
export function flightReasonLabel(v: string | null): string {
  if (!v) return "-";
  const key = FLIGHT_REASON_KEY[v];
  return key ? t(key) : v;
}
