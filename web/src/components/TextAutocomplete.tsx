import { useState, type KeyboardEvent } from "react";
import type { SuggestItem } from "../lib/api";
import { useI18n } from "../i18n";

interface TextAutocompleteProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SuggestItem[];
  placeholder?: string;
}

/** 이력 기반 자동완성 (기체타입·등록기호). 서버 /api/suggest 데이터를 클라이언트에서 필터링. */
export default function TextAutocomplete({ label, value, onChange, options, placeholder }: TextAutocompleteProps) {
  const { tn } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const q = value.trim().toLowerCase();
  const filtered = (q ? options.filter((o) => o.v.toLowerCase().includes(q)) : options).slice(0, 8);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1 >= filtered.length ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 < 0 ? filtered.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      // 방향키를 안 눌렀으면 첫 항목 선택
      const target = activeIndex >= 0 ? filtered[activeIndex] : filtered[0];
      if (target) {
        e.preventDefault();
        select(target.v);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActiveIndex(-1);
          setOpen(true); // 선택 후 다시 타이핑할 때 드롭다운 재개방
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line px-3 py-2 text-sm text-ink-title focus:border-line-accent focus:outline-none"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lg">
          {filtered.map((o, i) => (
            <li key={o.v}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(o.v)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  i === activeIndex ? "bg-accent-wash/60" : "hover:bg-accent-wash/60"
                }`}
              >
                <span className="text-ink-brand">{o.v}</span>
                <span className="text-xs text-ink-faint">{tn("common.usedCount", o.n)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
