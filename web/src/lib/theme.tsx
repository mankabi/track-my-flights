// 다크모드 테마 프로바이더: web/src/lib/units.tsx와 동일 패턴
// (Provider + 훅 + localStorage + auto 해석). resolved 값("light"|"dark")은
// document.documentElement.dataset.theme에 반영되어 index.css의 :root[data-theme] 및
// web/index.html의 FOUC 방지 인라인 스크립트와 계약을 이룬다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePref = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "tmf.theme";

function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    /* 프라이빗 모드 등 — 무시하고 기본값 */
  }
  return "auto";
}

function saveThemePref(p: ThemePref): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, p);
  } catch {
    /* 무시 */
  }
}

/** matchMedia 예외(구형 환경 등) 시 light로 방어. */
function detectSystemTheme(): ResolvedTheme {
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

interface ThemeContextValue {
  themePref: ThemePref;
  resolvedTheme: ResolvedTheme;
  setThemePref: (p: ThemePref) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePref, setThemePrefState] = useState<ThemePref>(() => loadThemePref());
  // auto일 때만 의미 있는 OS 감지값. auto가 아니면 themePref 자체가 곧 resolvedTheme이라 무관하다.
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => detectSystemTheme());

  const resolvedTheme: ResolvedTheme = themePref === "auto" ? systemTheme : themePref;

  // resolved 값을 document root에 반영 (렌더 중 side effect를 피하려고 effect에서 처리).
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  // pref가 auto일 때만 OS 전환을 실시간 구독 — 명시적 선택(light/dark)이면 구독할 이유가 없다.
  useEffect(() => {
    if (themePref !== "auto") return;
    let mql: MediaQueryList;
    try {
      mql = matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = () => setSystemTheme(mql.matches ? "dark" : "light");
    onChange(); // auto 복귀 시점의 OS 값 재동기화 — 구독이 끊겨 있던 동안의 변경을 놓쳤을 수 있다
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [themePref]);

  const setThemePref = useCallback((p: ThemePref) => {
    setThemePrefState(p);
    saveThemePref(p);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ themePref, resolvedTheme, setThemePref }),
    [themePref, resolvedTheme, setThemePref],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
