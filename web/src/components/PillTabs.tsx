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
                ? "bg-navy-900 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:border-navy-600 hover:text-navy-800"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
