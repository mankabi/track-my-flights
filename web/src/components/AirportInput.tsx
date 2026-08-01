import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type Airport } from "../lib/api";
import { useI18n } from "../i18n";

interface AirportInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  resolved: Airport | null;
  onResolve: (airport: Airport | null) => void;
  error?: string;
}

const IATA_CODE_RE = /^[A-Za-z]{3}$/;

/** 3글자 알파벳이면 코드로 간주해 대문자로, 그 외(도시명 등)는 원문 그대로 둔다. */
function normalizeInput(raw: string): string {
  return IATA_CODE_RE.test(raw) ? raw.toUpperCase() : raw;
}

/**
 * 공항 코드/도시명/공항명 인풋: 디바운스 자동완성 드롭다운 + 완전일치 자동 해석
 * + 키보드 조작(↑/↓/Enter/Esc) + 선택 시 도시·공항명 확인 표시.
 */
export default function AirportInput({ label, value, onChange, resolved, onResolve, error }: AirportInputProps) {
  const { t, tn } = useI18n();
  const [results, setResults] = useState<Airport[]>([]);
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
        .airports.search(q)
        .then((rows) => {
          if (seqRef.current !== mySeq) return; // 늦게 도착한 응답 무시
          setResults(rows);
          setActiveIndex(-1);
          const qLower = q.toLowerCase();
          const matches = rows.filter(
            (r) =>
              r.iata.toLowerCase() === qLower ||
              (r.city ?? "").toLowerCase() === qLower ||
              r.name.toLowerCase() === qLower,
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
    // 선택·자동해석 후 닫힌 드롭다운을 다시 연다.
    // (포커스가 이미 인풋에 있으면 onFocus가 재발동하지 않아 열리지 않는다)
    setOpen(true);
    if (resolved && resolved.iata !== next.toUpperCase()) onResolve(null);
  };

  const selectResult = (r: Airport) => {
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
      // 방향키를 안 눌렀으면 첫 항목 선택 — "Haneda" 입력 후 Enter 한 번으로 HND가 되게
      const target = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (target) {
        e.preventDefault();
        selectResult(target);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const isCodeDisplay = /^[A-Z]{3}$/.test(value);

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder={t("common.airportSearchPlaceholder")}
        className={`w-full rounded-xl border bg-white px-3 py-2 tracking-wide text-navy-900 transition-all focus:outline-none ${
          isCodeDisplay ? "text-2xl font-semibold" : "text-base font-normal"
        } ${error ? "border-red-400" : "border-slate-200 focus:border-navy-600"}`}
      />
      {resolved ? (
        <p className="mt-1 truncate text-xs text-slate-500">
          {resolved.city ?? "-"} · {resolved.name}
        </p>
      ) : error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : (
        <p className="mt-1 text-xs text-slate-300">{t("common.airportSearchHint")}</p>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full min-w-[320px] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {results.map((r, i) => (
            <li key={r.iata}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectResult(r)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                  i === activeIndex ? "bg-sky-100/60" : "hover:bg-sky-100/60"
                }`}
              >
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 font-semibold text-navy-900">{r.iata}</span>
                    <span className="truncate text-slate-600">{r.city ?? "-"}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {r.name} · {r.country}
                  </span>
                </span>
                {r.used > 0 && <span className="shrink-0 text-xs text-slate-400">{tn("common.usedCount", r.used)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
