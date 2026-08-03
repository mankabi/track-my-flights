import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type Airline } from "../lib/api";
import { decideBlurCommit, type NoCommitReason } from "../lib/autocomplete";
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
const DEBOUNCE_MS = 250;

/**
 * 항공사 인풋 — AirportInput.tsx와 동일한 문법(D41/D42/D43, WORKBOOK.md §17 v1.7).
 *
 * 핵심 규칙: **입력칸 텍스트는 사용자가 확정한 순간에만 바뀐다.** 타이핑 경로(검색 effect)에서는
 * 절대 onChange를 부르지 않는다 — 예전에는 정확일치 1건이면 검색 effect가 onChange(코드)로
 * 텍스트를 덮어써서, "KO"(Alaska Central Express)가 "Korean Air"를 칠 수 없게 만들었다.
 *
 *  - 해석(resolve): 타이핑 중 값이 정확히 유효 코드면 onResolve만 호출. 텍스트 불변.
 *  - 확정(commit): 항목 클릭 / Enter / Tab(활성항목) / blur 판정 통과 시에만 텍스트를 코드로 바꾼다.
 *  - 참조DB에 없는 자유 입력은 그대로 두고 resolved=null (D25 — "이름으로 자동 치환"은 철회됐다).
 *
 * AirportInput.tsx와 좌우 대칭으로 유지해야 한다(D22 — 과거 한쪽만 고쳐 비대칭 버그가 났다).
 */
const AirlineInput = forwardRef<HTMLInputElement, AirlineInputProps>(function AirlineInput(
  { label, value, onChange, resolved, onResolve, error },
  ref,
) {
  const { t, tn } = useI18n();
  const [results, setResults] = useState<Airline[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [noCommit, setNoCommit] = useState<NoCommitReason | null>(null);
  // 값이 "확정된" 상태인가 — 큰 글씨와 인라인 이름은 확정 후에만 붙인다(사용자 결정 2026-08-02).
  // 타이핑 중에도 코드 형태면 해석(resolved)은 걸리지만, 그때 이름을 크게 띄우면
  // "Korean Air"를 치는 중 Ko 단계에서 Alaska Central Express를 크게 주장하게 된다.
  // 초기값 true = 부모가 들고 온 값(편집 모드 로드)은 확정된 것으로 본다.
  const [committed, setCommitted] = useState(true);

  const seqRef = useRef(0);
  const debounceRef = useRef<number | undefined>(undefined);
  /** 마지막으로 성공한 검색의 (질의, 결과) — blur 판정에서 재요청 없이 재사용한다. */
  const latestRef = useRef<{ q: string; rows: Airline[] }>({ q: "", rows: [] });
  /** 비행 중인 요청 — blur가 같은 질의를 다시 쏘지 않고 이것을 await한다. */
  const pendingRef = useRef<{ q: string; promise: Promise<Airline[]> } | null>(null);
  const dismissedRef = useRef(false);
  const focusedRef = useRef(false);
  const valueRef = useRef(value);
  const resolvedRef = useRef(resolved);
  valueRef.current = value;
  resolvedRef.current = resolved;

  /** q를 실제로 검색해 상태·캐시를 갱신한다. 반환값은 그 q에 대한 결과 행. */
  const runSearch = (q: string): Promise<Airline[]> => {
    const mySeq = ++seqRef.current;
    const promise = api.airlines
      .search(q)
      .then((rows) => {
        // 늦게 도착한 응답은 상태에 반영하지 않는다(스테일 가드). 단 호출자에겐 그대로 돌려준다.
        if (seqRef.current !== mySeq) return rows;
        latestRef.current = { q, rows };
        setResults(rows);
        setActiveIndex(-1);
        // 해석만 한다 — 여기서 onChange를 부르면 타이핑 중 텍스트 덮어쓰기 버그가 그대로 부활한다.
        if (CODE_RE.test(q)) {
          const exact = rows.find((r) => r.iata.toLowerCase() === q.toLowerCase());
          if (exact && resolvedRef.current?.iata !== exact.iata) onResolve(exact);
        }
        return rows;
      })
      .catch(() => {
        if (seqRef.current === mySeq) {
          latestRef.current = { q, rows: [] };
          setResults([]);
        }
        return [] as Airline[];
      });
    pendingRef.current = { q, promise };
    return promise;
  };

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      seqRef.current++; // 비행 중인 응답이 빈 입력을 덮지 않게
      latestRef.current = { q: "", rows: [] };
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      debounceRef.current = undefined;
      void runSearch(q);
    }, DEBOUNCE_MS);
    debounceRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (debounceRef.current === timer) debounceRef.current = undefined;
    };
    // runSearch/resolved/onResolve/onChange는 의도적으로 의존성에서 제외 (매 타이핑마다 재실행 방지).
    // 최신 값이 필요한 것들은 전부 ref로 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // 언마운트 시 남은 디바운스를 정리하고, 늦게 온 응답이 setState 하지 않게 시퀀스를 올린다.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
      seqRef.current++;
    };
  }, []);

  const handleChange = (raw: string) => {
    // 정규화(대문자화) 금지 — 대문자화는 확정 시점에만 일어난다.
    onChange(raw);
    setOpen(true);
    dismissedRef.current = false;
    setNoCommit(null);
    setCommitted(false);
    if (resolved && raw.trim().toUpperCase() !== resolved.iata) onResolve(null);
  };

  /** 확정 — 텍스트를 코드로 바꾸는 유일한 경로. */
  const commit = (r: Airline) => {
    onChange(r.iata);
    onResolve(r);
    setOpen(false);
    setResults([]);
    setActiveIndex(-1);
    dismissedRef.current = false;
    setNoCommit(null);
    setCommitted(true);
    // 확정 직후의 blur 재판정이 불필요한 재요청을 하지 않도록 캐시도 확정값으로 맞춘다.
    latestRef.current = { q: r.iata, rows: [r] };
  };

  const handleFocus = () => {
    focusedRef.current = true;
    // 포커스가 곧 드롭다운 재오픈이므로 Esc 상태도 함께 푼다(둘이 어긋나면 상태가 모순된다).
    dismissedRef.current = false;
    setOpen(true);
  };

  const handleBlur = () => {
    focusedRef.current = false;
    setOpen(false);
    const raw = valueRef.current;
    const q = raw.trim();
    // 빈 값에서는 어떤 경우에도 onChange를 부르지 않는다 — 부모가 airlineTouched를 켜면
    // 편명→항공사 자동채움이 영구히 꺼진다.
    if (!q) {
      setNoCommit(null);
      return;
    }
    // 대기 중인 디바운스를 flush한다 — 안 그러면 results가 비었거나 낡아 판정이 헛돈다.
    if (debounceRef.current !== undefined) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    const cached = latestRef.current;
    const pending = pendingRef.current;
    const rowsPromise =
      cached.q === q
        ? Promise.resolve(cached.rows)
        : pending?.q === q
          ? pending.promise
          : runSearch(q);

    void rowsPromise.then((rows) => {
      // 늦게 도착한 결과로 확정할 때의 경합 가드:
      // 그 사이 값이 바뀌었거나 필드가 다시 포커스됐으면 버린다.
      if (valueRef.current !== raw || focusedRef.current) return;
      const decision = decideBlurCommit(raw, rows, { codeLength: 2, dismissed: dismissedRef.current });
      if (decision.kind === "commit") commit(decision.item);
      else setNoCommit(decision.reason);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      dismissedRef.current = true;
      setOpen(false);
      return;
    }
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
        commit(target);
      }
    } else if (e.key === "Tab" && activeIndex >= 0) {
      // preventDefault 하지 않는다 — 포커스는 다음 필드로 넘어가야 한다.
      commit(results[activeIndex]);
    }
  };

  // 큰 글씨·인라인 이름은 "확정된 코드"일 때만 — 타이핑 중에는 크기가 흔들리지도, 엉뚱한 이름을
  // 크게 주장하지도 않는다. 타이핑 중 해석 결과는 아래 작은 라벨로만 힌트를 준다.
  const isCodeDisplay = resolved != null && committed && value.trim().toUpperCase() === resolved.iata;
  const resolvedName = resolved ? (resolved.name ?? "").trim() : "";
  const inlineName = isCodeDisplay ? resolvedName : "";
  // 자유 입력(참조DB에 없음)과 "후보 중에 골라야 함"은 안내가 다르다.
  const freeInput = noCommit === "unknown-code" || noCommit === "no-match";

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      <div className="relative">
        <input
          ref={ref}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={t("common.airlineSearchPlaceholder")}
          className={`w-full rounded-xl border bg-surface py-2 pl-3 tracking-wide text-ink-title transition-all focus:outline-none ${
            inlineName ? "pr-3 sm:pr-32" : "pr-3"
          } ${isCodeDisplay ? "text-2xl font-semibold" : "text-base font-normal"} ${
            error ? "border-line-danger" : "border-line focus:border-line-accent"
          }`}
        />
        {/* D43: 코드와 이름을 동등한 무게로 — 이름은 표시로만 승격하고 필드 값은 코드를 유지한다(D25). */}
        {inlineName ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 hidden max-w-[60%] items-center sm:flex">
            <span className="truncate text-base text-ink-soft">{inlineName}</span>
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-ink-danger">{error}</p>
      ) : resolved ? (
        // 인라인 이름이 붙는 화면(확정+sm↑)에서는 아래 라벨을 비운다 — 국적은 불필요(사용자 결정
        // 2026-08-02). 인라인이 없는 화면(모바일·타이핑 중 해석)에서만 이름을 여기서 보여준다.
        // min-h는 라벨이 빌 때 필드 높이가 흔들리지 않게 하려고 남긴다.
        <p className="mt-1 min-h-[1rem] truncate text-xs text-ink-muted">
          {inlineName ? <span className="sm:hidden">{resolvedName}</span> : resolvedName}
        </p>
      ) : freeInput ? (
        <p className="mt-1 text-xs text-ink-faint">{t("common.airlineNoMatch")}</p>
      ) : noCommit === "ambiguous" ? (
        <p className="mt-1 text-xs text-ink-muted">{t("common.pickFromList")}</p>
      ) : (
        <p className="mt-1 text-xs text-ink-ghost">{t("common.airlineSearchHint")}</p>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full min-w-[280px] overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lg">
          {results.map((r, i) => (
            <li key={r.iata}>
              <button
                type="button"
                // Tab 순서에서 제외한다(표준 combobox 문법 — 항목은 화살표·Enter·클릭으로만 다룬다).
                // 0이면 Tab의 다음 대상이 이 버튼이 되는데, blur 핸들러가 같은 순간 드롭다운을 닫아
                // 대상이 사라지므로 포커스가 body로 떨어진다(실측: focusout만 찍히고 focusin이 없다).
                // 그러면 코드를 치고 Tab으로 다음 칸에 가는 동선이 끊긴다.
                tabIndex={-1}
                // blur보다 click이 먼저 처리되게 하는 유일한 장치 — 제거하면 blur 판정이 클릭을 앞질러
                // 엉뚱한 항목이 확정된다.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => commit(r)}
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
