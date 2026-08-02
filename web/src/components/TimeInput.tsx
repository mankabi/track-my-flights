import { useEffect, useRef, useState } from "react";
import { formatClock, type TimeFormat } from "../lib/units";

interface TimeInputProps {
  label: string;
  value: string; // 캐노니컬 "HH:MM"(24h) | "" — 부모가 저장·검증하는 값은 항상 24h다
  onChange: (value: string) => void;
  error?: string;
  /** 표시·입력 형식 (D32-2). h12면 필드·피커가 12h(AM/PM)로 동작하되 캐노니컬은 24h 유지. */
  format?: TimeFormat;
}

const HOURS24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
// 12h 시 열은 12, 1..11 순 (시계 관례)
const HOURS12 = ["12", ...Array.from({ length: 11 }, (_, i) => String(i + 1))];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 입력 텍스트 → 캐노니컬 24h "HH:MM". 실패 시 null.
 *  h12 모드에서도 24h 표기("16:00")는 받아준다. AM/PM 없는 "4:00"은 시가 13 미만이면 그대로 24h로 해석. */
function parseDraft(raw: string, format: TimeFormat): string | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  const m = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2];
  const mer = m[3];
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "AM") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else {
    // AM/PM 생략 시 24h로 해석 ("16:00"→16시, "4:00"→04시) — h12 모드에서도 24h 타이핑을 받아준다
    if (h > 23) return null;
  }
  return `${String(h).padStart(2, "0")}:${min}`;
}

/** 캐노니컬 → 표시 문자열 */
function display(canonical: string, format: TimeFormat): string {
  if (!HHMM_RE.test(canonical)) return canonical;
  return format === "h12" ? formatClock(canonical, "h12") : canonical;
}

/**
 * 커스텀 시각 입력 (D26/D32-2): 네이티브 <input type="time">은 순환 스크롤이라 폐기.
 * 직접 타이핑 + 비순환 시·분(·AM/PM) 리스트. 내부 계약: 부모와 주고받는 값은 항상 24h 캐노니컬,
 * 12h는 표시 계층에서만 — 거리 단위(D32-1)와 같은 원칙이다.
 */
export default function TimeInput({ label, value, onChange, error, format = "h24" }: TimeInputProps) {
  const [open, setOpen] = useState(false);
  // draft = 인풋에 실제로 보이는 문자열. 타이핑 중간 상태를 보존하고, 유효해지면 캐노니컬로 부모에 전달.
  const [draft, setDraft] = useState(() => display(value, format));
  const blurTimer = useRef<number | undefined>(undefined);
  const hourListRef = useRef<HTMLUListElement>(null);
  const minuteListRef = useRef<HTMLUListElement>(null);

  // 외부에서 value가 바뀌면(편집 모드 로드, 피커 클릭) draft를 표시 형식으로 동기화.
  // 타이핑 중(draft가 같은 캐노니컬을 가리키는 중)에는 건드리지 않는다.
  useEffect(() => {
    const parsed = parseDraft(draft, format);
    if ((parsed ?? draft) !== value) setDraft(display(value, format));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, format]);

  const m = HHMM_RE.exec(value);
  const h24 = m ? m[1] : null;
  const min = m ? m[2] : null;
  const meridiem: "AM" | "PM" | null = h24 == null ? null : Number(h24) < 12 ? "AM" : "PM";
  const h12 = h24 == null ? null : String(((Number(h24) + 11) % 12) + 1); // 0→12, 13→1

  const hourList = format === "h12" ? HOURS12 : HOURS24;
  const activeHour = format === "h12" ? h12 : h24;

  // D35: 12h 모드에서 AM/PM 없이 "7:30"을 치면 07:30으로 읽는다 — 12h 모드에서도 24h 타이핑("16:00")을
  // 받아주기로 한 설계상 불가피하다("PM으로 추측"은 같은 입력이 다른 값이 되므로 기각). 지금까지 그 해석은
  // blur 후에야 보였다 → 파싱되는 즉시 필드 아래에 결과를 에코해 타이핑 중에 드러낸다.
  // 입력 원문과 표시형이 같아지면(= "7:30 PM"까지 다 친 뒤, 피커 선택, 편집 모드 로드) 저절로 사라진다.
  // h24 모드는 해석이 애매할 여지가 없으므로 에코하지 않는다. 문자열이 시각값뿐이라 카탈로그 추가도 없다.
  const echo = (() => {
    if (format !== "h12") return null;
    const parsed = parseDraft(draft, format);
    if (!parsed) return null;
    const shown = display(parsed, format);
    return shown === draft.trim() ? null : shown;
  })();

  useEffect(() => {
    if (!open) return;
    const scrollTo = (list: HTMLUListElement | null, target: string | null) => {
      if (!list) return;
      const el = (target ? list.querySelector(`[data-v="${target}"]`) : list.firstElementChild) as HTMLElement | null;
      el?.scrollIntoView({ block: "center" });
    };
    scrollTo(hourListRef.current, activeHour);
    scrollTo(minuteListRef.current, min);
    // 열릴 때 1회만 스크롤 (h/min 변경마다 재스크롤하면 선택 중 튀는 느낌을 준다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (canonical: string) => {
    onChange(canonical);
    setDraft(display(canonical, format));
  };

  const toCanonicalHour = (pickedH12: string, mer: "AM" | "PM"): string => {
    const n = Number(pickedH12);
    const h = mer === "AM" ? (n === 12 ? 0 : n) : n === 12 ? 12 : n + 12;
    return String(h).padStart(2, "0");
  };

  const pickHour = (nh: string) => {
    if (format === "h12") {
      commit(`${toCanonicalHour(nh, meridiem ?? "AM")}:${min ?? "00"}`);
    } else {
      commit(`${nh}:${min ?? "00"}`);
    }
  };
  const pickMinute = (nm: string) => {
    commit(`${h24 ?? "00"}:${nm}`);
    // h12는 AM/PM 열이 완결점이므로 열어둔다 (읽기 순서 좌→우의 끝에서 닫힘)
    if (format !== "h12") setOpen(false);
  };
  const pickMeridiem = (mer: "AM" | "PM") => {
    const base = h12 ?? "12";
    commit(`${toCanonicalHour(base, mer)}:${min ?? "00"}`);
    setOpen(false);
  };

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = parseDraft(raw, format);
          // 유효하면 캐노니컬, 아니면 원문 그대로 전달 — 부모 검증(HH:MM)이 잡아서 에러 표시
          onChange(parsed ?? raw);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
          const parsed = parseDraft(draft, format);
          if (parsed) commit(parsed); // blur 시 표시 정규화 ("4:00pm" → "4:00 PM")
        }}
        placeholder={format === "h12" ? "H:MM AM" : "HH:MM"}
        className={`w-full rounded-xl border bg-surface px-3 py-2 text-sm text-ink-title focus:outline-none ${
          error ? "border-line-danger" : "border-line focus:border-line-accent"
        }`}
      />
      {error ? (
        <p className="mt-1 text-xs text-ink-danger">{error}</p>
      ) : echo ? (
        <p className="mt-1 text-xs text-ink-faint">→ {echo}</p>
      ) : null}
      {open && (
        <div className="absolute z-20 mt-1 flex w-full min-w-[150px] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <ul ref={hourListRef} className="h-48 flex-1 overflow-y-auto border-r border-line-soft py-1">
            {hourList.map((hh) => (
              <li key={hh} data-v={hh}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickHour(hh)}
                  className={`w-full px-3 py-1.5 text-center text-sm ${
                    hh === activeHour ? "bg-accent-wash/60 font-semibold text-ink-title" : "text-ink-soft hover:bg-accent-wash/60"
                  }`}
                >
                  {hh}
                </button>
              </li>
            ))}
          </ul>
          <ul ref={minuteListRef} className={`h-48 flex-1 overflow-y-auto py-1 ${format === "h12" ? "border-r border-line-soft" : ""}`}>
            {MINUTES.map((mm) => (
              <li key={mm} data-v={mm}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickMinute(mm)}
                  className={`w-full px-3 py-1.5 text-center text-sm ${
                    mm === min ? "bg-accent-wash/60 font-semibold text-ink-title" : "text-ink-soft hover:bg-accent-wash/60"
                  }`}
                >
                  {mm}
                </button>
              </li>
            ))}
          </ul>
          {format === "h12" && (
            <ul className="h-48 w-14 shrink-0 py-1">
              {(["AM", "PM"] as const).map((mer) => (
                <li key={mer}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickMeridiem(mer)}
                    className={`w-full px-2 py-1.5 text-center text-sm ${
                      mer === meridiem ? "bg-accent-wash/60 font-semibold text-ink-title" : "text-ink-soft hover:bg-accent-wash/60"
                    }`}
                  >
                    {mer}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
