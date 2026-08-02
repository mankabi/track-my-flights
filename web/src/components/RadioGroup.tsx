interface RadioOption {
  value: string;
  label: string;
}

interface RadioGroupProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: RadioOption[];
}

export default function RadioGroup({ label, value, onChange, options }: RadioGroupProps) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value || "__none__"}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-2 text-ink-inverse"
                  : "border border-line text-ink-soft hover:border-line-accent hover:text-ink-brand"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
