interface RoutePairProps {
  depIata: string;
  arrIata: string;
  depCity?: string | null;
  arrCity?: string | null;
  size?: "md" | "lg";
}

/** 공항코드를 크게 보여주는 이 앱의 시그니처 컴포넌트: DEP → ARR */
export default function RoutePair({ depIata, arrIata, depCity, arrCity, size = "md" }: RoutePairProps) {
  const codeCls = size === "lg" ? "text-3xl md:text-4xl" : "text-2xl";
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <div className={`${codeCls} font-semibold tracking-wide text-ink-title`}>{depIata}</div>
        {depCity && <div className="text-xs text-ink-faint">{depCity}</div>}
      </div>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-accent-soft">
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
      <div>
        <div className={`${codeCls} font-semibold tracking-wide text-ink-title`}>{arrIata}</div>
        {arrCity && <div className="text-xs text-ink-faint">{arrCity}</div>}
      </div>
    </div>
  );
}
