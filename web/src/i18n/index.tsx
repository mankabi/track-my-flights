// v1.4 i18n (D29/D30, WORKBOOK.md §13-14): 제로 의존성 카탈로그 + 훅.
// ko.json이 source of truth — MsgKey는 ko.json의 키 집합에서 파생되고, en.json은 그 집합과
// 정확히 일치해야 컴파일된다(아래 KeysEqual 검증 — 누락/과잉 모두 컴파일 타임에 잡는다).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ko from "./ko.json";
import enJson from "./en.json";

export type MsgKey = keyof typeof ko;

// en.json이 ko.json과 정확히 같은 키 집합을 갖는지 컴파일 타임에 검증.
// 두 방향 모두 만족해야 true — 한쪽이라도 어긋나면(키 누락 또는 과잉) 아래 상수 선언이 컴파일 에러가 된다.
// [A]/[B]로 튜플 감싸기 — naked type parameter라 그냥 A extends B로 쓰면 유니언에 분배되어(distributive
// conditional types) 멤버 단위로 쪼개지면서 이 판정 자체가 항상 false가 되는 함정이 있다(204개 키로 실측 확인).
type KeysEqual<A extends string, B extends string> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type EnKeysMatchKo = KeysEqual<keyof typeof enJson, MsgKey>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertEnKeysMatchKo: EnKeysMatchKo extends true ? true : never = true;

const en: Record<MsgKey, string> = enJson;

export type Lang = "ko" | "en";
export type Pref = "auto" | "ko" | "en";
export type MsgParams = Record<string, string | number>;

// 나중에 언어 추가 시: ko.json 옆에 xx.json 만들고 여기 한 줄 등록 + Lang/Pref 유니언에 추가.
const LANGS: Record<Lang, Record<MsgKey, string>> = { ko, en };

const STORAGE_KEY = "tmf.lang";

function loadPref(): Pref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ko" || v === "en" || v === "auto") return v;
  } catch {
    /* 프라이빗 모드 등 — 무시하고 기본값 */
  }
  return "auto";
}

function savePref(p: Pref): void {
  try {
    localStorage.setItem(STORAGE_KEY, p);
  } catch {
    /* 무시 */
  }
}

function detectLang(): Lang {
  try {
    return navigator.language?.toLowerCase().startsWith("ko") ? "ko" : "en";
  } catch {
    return "en";
  }
}

function resolveLang(pref: Pref): Lang {
  return pref === "auto" ? detectLang() : pref;
}

function interpolate(template: string, params?: MsgParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

function tImpl(lang: Lang, key: MsgKey, params?: MsgParams): string {
  const template = LANGS[lang][key];
  // 미존재 키는 throw 대신 키 문자열 그대로 fallback (CLAUDE.md 지침).
  if (template == null) return String(key);
  return interpolate(template, params);
}

function tnImpl(lang: Lang, baseKey: string, n: number, params?: MsgParams): string {
  const suffix = Math.abs(n) === 1 ? "one" : "other";
  const key = `${baseKey}_${suffix}` as MsgKey;
  return tImpl(lang, key, { n, ...params });
}

// 컴포넌트 트리 밖(web/src/lib/api.ts, format.ts)에서 현재 언어를 읽기 위한 모듈 수준 상태.
// I18nProvider가 lang이 바뀔 때마다 effect로 동기화한다 — React 컨텍스트 밖에서도 번역이 필요한
// request()의 에러 메시지, format.ts의 날짜/숫자 로케일 포맷팅에 쓰인다.
let currentLang: Lang = resolveLang(loadPref());

export function getLang(): Lang {
  return currentLang;
}

/** 모듈 수준 번역 헬퍼 — 훅을 쓸 수 없는 곳(api.ts request())에서 현재 언어로 번역한다. */
export function t(key: MsgKey, params?: MsgParams): string {
  return tImpl(currentLang, key, params);
}

/** 서버 에러 코드 → 카탈로그 errors.<code> 번역. 카탈로그에 없는 코드는 코드 문자열 그대로 fallback. */
export function translateError(code: string, params?: Record<string, string>): string {
  const key = `errors.${code}` as MsgKey;
  const template = LANGS[currentLang][key];
  if (template == null) return code;
  return interpolate(template, params);
}

interface I18nContextValue {
  lang: Lang;
  pref: Pref;
  setPref: (p: Pref) => void;
  t: (key: MsgKey, params?: MsgParams) => string;
  tn: (baseKey: string, n: number, params?: MsgParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<Pref>(() => loadPref());
  const lang = resolveLang(pref);

  // 모듈 수준 currentLang을 React 상태와 동기화 (렌더 중 side effect를 피하려고 effect에서 처리 —
  // WorldMap focusRef 건과 동일한 이유, CLAUDE.md "이미 밟은 함정" 참조).
  useEffect(() => {
    currentLang = lang;
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setPref = useCallback((p: Pref) => {
    setPrefState(p);
    savePref(p);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      pref,
      setPref,
      t: (key, params) => tImpl(lang, key, params),
      tn: (baseKey, n, params) => tnImpl(lang, baseKey, n, params),
    }),
    [lang, pref, setPref],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
