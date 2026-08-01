// v1.4.1 단위 프로바이더 (D32, WORKBOOK.md §13): web/src/i18n/index.tsx와 동일 패턴
// (Provider + 훅 + localStorage + auto 해석). 표시 전용 — DB 저장(km)·폼 입력(km, HH:MM)·
// 소요시간(H:MM, 경과시간이라 AM/PM 무관)은 이 파일과 무관하게 항상 불변으로 유지된다(호출부 책임).
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Lang } from "../i18n";

export type DistancePref = "auto" | "km" | "mi";
export type TimePref = "auto" | "h24" | "h12";
export type DistanceUnit = "km" | "mi";
export type TimeFormat = "h24" | "h12";

const DISTANCE_STORAGE_KEY = "tmf.units.distance";
const TIME_STORAGE_KEY = "tmf.units.time";

// auto 해석에서 마일을 쓰는 지역 (region 코드). 그 외 전부 km.
const MILE_REGIONS = new Set(["US", "GB", "LR", "MM"]);

function loadDistancePref(): DistancePref {
  try {
    const v = localStorage.getItem(DISTANCE_STORAGE_KEY);
    if (v === "km" || v === "mi" || v === "auto") return v;
  } catch {
    /* 프라이빗 모드 등 — 무시하고 기본값 */
  }
  return "auto";
}

function saveDistancePref(p: DistancePref): void {
  try {
    localStorage.setItem(DISTANCE_STORAGE_KEY, p);
  } catch {
    /* 무시 */
  }
}

function loadTimePref(): TimePref {
  try {
    const v = localStorage.getItem(TIME_STORAGE_KEY);
    if (v === "h24" || v === "h12" || v === "auto") return v;
  } catch {
    /* 무시 */
  }
  // 초기 기본값 auto (D32 재개정): ko-KR의 Intl 로케일 기본이 12h라는 사실을 사용자에게 보고하자
  // "디폴트도 자동기준 12h로 바꾸자"로 확정 — 로케일 관례를 그대로 따른다. 24h는 명시 선택지.
  return "auto";
}

function saveTimePref(p: TimePref): void {
  try {
    localStorage.setItem(TIME_STORAGE_KEY, p);
  } catch {
    /* 무시 */
  }
}

/** 브라우저 로케일의 hour12 판정. Intl 예외(잘못된 로케일 태그 등) 시 h24로 방어. */
function detectTimeFormat(): TimeFormat {
  try {
    const { hour12 } = new Intl.DateTimeFormat(navigator.language, { hour: "numeric" }).resolvedOptions();
    return hour12 ? "h12" : "h24";
  } catch {
    return "h24";
  }
}

/** 브라우저 로케일의 region 판정 (Intl.Locale.maximize 미지원 환경 방어 — 실패 시 km). */
function detectDistanceUnit(): DistanceUnit {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && MILE_REGIONS.has(region) ? "mi" : "km";
  } catch {
    return "km";
  }
}

function resolveDistanceUnit(pref: DistancePref): DistanceUnit {
  return pref === "auto" ? detectDistanceUnit() : pref;
}

function resolveTimeFormat(pref: TimePref): TimeFormat {
  return pref === "auto" ? detectTimeFormat() : pref;
}

export const KM_TO_MI = 0.621371;

// format.ts의 NUM_LOCALE과 동일 매핑(그쪽은 비공개 상수라 별도 보유 — lib/format.ts 미변경 원칙).
const NUM_LOCALE: Record<Lang, string> = { ko: "ko-KR", en: "en-US" };

/** km -> "451 km" / "280 mi" (반올림 정수, locale 천단위 구분). 저장값(km)은 그대로, 표시만 변환. */
export function formatDistance(km: number | null | undefined, unit: DistanceUnit, lang: Lang): string {
  if (km == null) return "-";
  const value = unit === "mi" ? km * KM_TO_MI : km;
  return `${Math.round(value).toLocaleString(NUM_LOCALE[lang])} ${unit}`;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * "HH:MM"(24h 저장값) -> h24면 그대로, h12면 "2:30 PM" 등으로 변환.
 * 경계: 00:xx -> 12:xx AM, 12:xx -> 12:xx PM, 13:xx -> 1:xx PM. 형식이 아니면 원문 그대로 반환.
 */
export function formatClock(hhmm: string | null | undefined, fmt: TimeFormat): string {
  if (!hhmm) return "-";
  if (fmt === "h24") return hhmm;
  const m = HHMM_RE.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${period}`;
}

interface UnitsContextValue {
  distanceUnit: DistanceUnit;
  timeFormat: TimeFormat;
  distancePref: DistancePref;
  timePref: TimePref;
  setDistancePref: (p: DistancePref) => void;
  setTimePref: (p: TimePref) => void;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [distancePref, setDistancePrefState] = useState<DistancePref>(() => loadDistancePref());
  const [timePref, setTimePrefState] = useState<TimePref>(() => loadTimePref());

  const distanceUnit = resolveDistanceUnit(distancePref);
  const timeFormat = resolveTimeFormat(timePref);

  const setDistancePref = useCallback((p: DistancePref) => {
    setDistancePrefState(p);
    saveDistancePref(p);
  }, []);

  const setTimePref = useCallback((p: TimePref) => {
    setTimePrefState(p);
    saveTimePref(p);
  }, []);

  const value = useMemo<UnitsContextValue>(
    () => ({ distanceUnit, timeFormat, distancePref, timePref, setDistancePref, setTimePref }),
    [distanceUnit, timeFormat, distancePref, timePref, setDistancePref, setTimePref],
  );

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error("useUnits must be used within UnitsProvider");
  return ctx;
}
