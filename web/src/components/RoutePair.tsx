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
  // 열 폭 고정(w-28) + 도시명 truncate: 폭을 내용에 맡기면 도시명 길이에 따라 블록이 47~98px로 들쭉날쭉해져
  // 목록에서 코드·화살표·도착코드가 행마다 어긋난다(대시보드 "최근 비행"에서 실제 발생).
  // 코드는 어떤 데이터에서도 같은 세로선에 오도록 출발은 우측, 도착은 좌측 정렬로 고정한다.
  const colCls = "w-28 shrink-0";
  return (
    <div className="flex items-center gap-3">
      <div className={`${colCls} text-right`}>
        <div className={`${codeCls} font-semibold tracking-wide text-ink-title`}>{depIata}</div>
        {depCity && <div className="truncate text-xs text-ink-faint" title={depCity}>{depCity}</div>}
      </div>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-accent-soft">
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
      <div className={colCls}>
        <div className={`${codeCls} font-semibold tracking-wide text-ink-title`}>{arrIata}</div>
        {arrCity && <div className="truncate text-xs text-ink-faint" title={arrCity}>{arrCity}</div>}
      </div>
    </div>
  );
}
