interface PillTabsProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function PillTabs({ options, value, onChange, className = "" }: PillTabsProps) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-brand text-ink-inverse"
                : "border border-line bg-surface text-ink-soft hover:border-line-accent hover:text-ink-brand"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
