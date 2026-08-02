import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type Airline } from "../lib/api";
import { useI18n } from "../i18n";

interface AirlineInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  resolved: Airline | null;
  onResolve: (airline: Airline | null) => void;
  error?: string;
}

const CODE_RE = /^[A-Za-z0-9]{2}$/;

/** 2글자 영숫자면 코드로 간주해 대문자로, 그 외(항공사명 등)는 원문 그대로 둔다. */
function normalizeInput(raw: string): string {
  return CODE_RE.test(raw) ? raw.toUpperCase() : raw;
}

/**
 * 항공사 인풋: AirportInput.tsx와 동일한 문법 — 디바운스 자동완성 드롭다운 + 완전일치 자동 해석
 * (코드 또는 이름 정확일치가 유일하면 입력칸=코드로 치환) + 키보드 조작 + 아래 라벨에 정식 명칭 표시.
 * 참조DB에 없는 자유 입력은 그대로 두고 resolved=null (D25 — v1.2.1의 "이름으로 자동 치환"은 철회).
 */
const AirlineInput = forwardRef<HTMLInputElement, AirlineInputProps>(function AirlineInput(
  { label, value, onChange, resolved, onResolve, error },
  ref,
) {
  const { t, tn } = useI18n();
  const [results, setResults] = useState<Airline[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const blurTimer = useRef<number | undefined>(undefined);
  const seqRef = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const mySeq = ++seqRef.current;
    const timer = window.setTimeout(() => {
      api
        .airlines.search(q)
        .then((rows) => {
          if (seqRef.current !== mySeq) return; // 늦게 도착한 응답 무시
          setResults(rows);
          setActiveIndex(-1);
          const qLower = q.toLowerCase();
          const matches = rows.filter(
            (r) => r.iata.toLowerCase() === qLower || r.name.toLowerCase() === qLower,
          );
          if (matches.length === 1) {
            const exact = matches[0];
            if (!resolved || resolved.iata !== exact.iata) {
              onChange(exact.iata);
              onResolve(exact);
              setOpen(false);
            }
          }
        })
        .catch(() => {
          if (seqRef.current === mySeq) setResults([]);
        });
    }, 250);
    return () => window.clearTimeout(timer);
    // resolved/onResolve/onChange는 의도적으로 의존성에서 제외 (매 타이핑마다 재실행 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (raw: string) => {
    const next = normalizeInput(raw);
    onChange(next);
    setOpen(true);
    if (resolved && resolved.iata !== next.toUpperCase()) onResolve(null);
  };

  const selectResult = (r: Airline) => {
    onChange(r.iata);
    onResolve(r);
    setOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1 >= results.length ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 < 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      const target = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (target) {
        e.preventDefault();
        selectResult(target);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const isCodeDisplay = /^[A-Z0-9]{2}$/.test(value);

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      <input
        ref={ref}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder={t("common.airlineSearchPlaceholder")}
        className={`w-full rounded-xl border bg-surface px-3 py-2 tracking-wide text-ink-title transition-all focus:outline-none ${
          isCodeDisplay ? "text-2xl font-semibold" : "text-base font-normal"
        } ${error ? "border-line-danger" : "border-line focus:border-line-accent"}`}
      />
      {error ? (
        <p className="mt-1 text-xs text-ink-danger">{error}</p>
      ) : resolved ? (
        <p className="mt-1 truncate text-xs text-ink-muted">{resolved.name}</p>
      ) : value.trim() ? (
        <p className="mt-1 text-xs text-ink-faint">{t("common.airlineNoMatch")}</p>
      ) : (
        <p className="mt-1 text-xs text-ink-ghost">{t("common.airlineSearchHint")}</p>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full min-w-[280px] overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lg">
          {results.map((r, i) => (
            <li key={r.iata}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectResult(r)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                  i === activeIndex ? "bg-accent-wash/60" : "hover:bg-accent-wash/60"
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-ink-title">{r.iata}</span>
                  <span className="ml-2 text-ink-soft">{r.name}</span>
                </span>
                {r.used > 0 && <span className="shrink-0 text-xs text-ink-faint">{tn("common.usedCount", r.used)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default AirlineInput;
