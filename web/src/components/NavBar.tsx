import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n, type MsgKey, type Pref } from "../i18n";
import { useTheme } from "../lib/theme";
import { GlobeIcon } from "./icons";

// 라우트 매칭을 명시적으로 준다 — "/flights"로 시작하는지가 아니라, 실제로 어느 화면인지로 판정.
// (NavLink 기본 prefix 매칭을 쓰면 /flights/new에서 "기록"도 함께 활성화되는 문제가 있었음.)
const NAV_ITEMS: { to: string; labelKey: MsgKey; isActive: (pathname: string) => boolean }[] = [
  { to: "/", labelKey: "nav.dashboard", isActive: (p) => p === "/" },
  {
    to: "/flights",
    labelKey: "nav.flights",
    isActive: (p) => p === "/flights" || /^\/flights\/[^/]+\/edit$/.test(p),
  },
  { to: "/flights/new", labelKey: "nav.add", isActive: (p) => p === "/flights/new" },
  { to: "/stats", labelKey: "nav.stats", isActive: (p) => p === "/stats" },
  { to: "/settings", labelKey: "nav.settings", isActive: (p) => p === "/settings" },
];

export default function NavBar() {
  const location = useLocation();
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  // 브랜드 SVG는 fill이 파일에 박혀 있어(img 로드라 CSS 불가) 다크 전용 변형 파일로 스왑.
  // 브랜딩 리뉴얼(§14 추가 태스크) 때 에셋이 통째로 교체될 예정이라 최소 대응으로 유지.
  const dark = resolvedTheme === "dark";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5 text-ink-title">
          {/* 브랜드 SVG(Recraft 생성) — 배경 제거·단색 통일·viewBox 콘텐츠 크롭본 */}
          <img src={dark ? "/logo-dark.svg" : "/logo.svg"} alt="" className="h-9" />
          <img src={dark ? "/wordmark-dark.svg" : "/wordmark.svg"} alt="Track My Flights" className="h-7" />
        </Link>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = item.isActive(location.pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "text-ink-title underline decoration-2 underline-offset-8"
                      : "text-ink-muted hover:text-ink-brand"
                  }`}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>
          <LangChip />
        </div>
      </div>
    </header>
  );
}

/**
 * 언어 힌트 칩 (D32 §4): globe 아이콘 + 현재 언어명. 모르는 언어로 화면이 떠도 아이콘으로
 * "언어 설정"임을 인지할 수 있어야 한다는 취지라 아이콘은 항상 필수로 노출한다.
 * 드롭다운은 기존 문법 재사용(TimeInput/AirlineInput과 동일): blur 150ms + Esc + z-20 rounded-xl shadow-lg.
 */
function LangChip() {
  const { t, lang, pref, setPref } = useI18n();
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);

  const options: { value: Pref; label: string }[] = [
    { value: "auto", label: t("settings.langAuto") },
    { value: "ko", label: t("settings.langKo") },
    { value: "en", label: t("settings.langEn") },
  ];
  // 칩 본문은 현재 실제로 적용된 언어명(자동이어도 해석된 결과)을 그대로 보여준다.
  const currentLangName = lang === "ko" ? t("settings.langKo") : t("settings.langEn");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        aria-label={t("nav.langChipAria")}
        className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink-brand"
      >
        <GlobeIcon size={16} />
        {currentLangName}
      </button>
      {open && (
        <ul className="absolute right-0 z-20 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setPref(opt.value);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  opt.value === pref ? "bg-accent-wash/60 font-semibold text-ink-title" : "text-ink-soft hover:bg-accent-wash/60"
                }`}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
