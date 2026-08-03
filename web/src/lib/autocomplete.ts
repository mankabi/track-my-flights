// 자동완성 blur 자동확정 판정 (D42, WORKBOOK.md §17 v1.7).
//
// AirportInput / AirlineInput이 이 모듈 하나만 공유한다. 두 컴포넌트는 오래 복붙 상태였고
// 한쪽만 고쳐져 비대칭 버그가 났던 이력이 있어(D22), 판정 규칙은 반드시 여기 한 곳에만 둔다.
//
// 설계 원칙(D41): 입력칸 텍스트는 "사용자가 확정한 순간"에만 바뀐다. 타이핑 중에는 절대 건드리지
// 않는다. 이 함수는 blur 시점의 자동확정 여부만 판정하고, 텍스트 치환은 호출자가 한다.
//
// 이 파일은 web/src/lib/*.test.ts(=tsx --test, node)에서 직접 돈다 —
// React/DOM/fetch 등 브라우저 API에 절대 의존하지 마라.

/** 판정 대상의 최소 구조. Airport(city 있음)와 Airline(city 없음) 둘 다 만족한다. */
export interface CommitTarget {
  iata: string;
  name: string;
  city?: string | null;
}

/**
 * 확정하지 못한 이유. 호출자가 아래 안내 문구를 고르는 데 쓴다.
 * - unknown-code / no-match: 참조DB에 없는 자유 입력 → 입력한 그대로 보존된다(D25).
 * - ambiguous: 후보는 있는데 하나로 좁혀지지 않는다 → 사용자가 골라야 한다.
 */
export type NoCommitReason = "empty" | "unknown-code" | "no-match" | "ambiguous";

export type BlurDecision<T> = { kind: "commit"; item: T } | { kind: "none"; reason: NoCommitReason };

export interface BlurOptions {
  /** 공항 3(알파벳), 항공사 2(영숫자). */
  codeLength: 2 | 3;
  /** 사용자가 Esc로 드롭다운을 닫았는가. */
  dismissed: boolean;
}

const CODE_RE = {
  2: /^[A-Za-z0-9]{2}$/,
  3: /^[A-Za-z]{3}$/,
} as const;

/**
 * blur 시 자동확정 판정 (D42). 텍스트 치환은 호출자가 한다.
 * 규칙은 순서대로 평가하고, 먼저 걸리는 것이 이긴다.
 */
export function decideBlurCommit<T extends CommitTarget>(
  raw: string,
  results: T[],
  opts: BlurOptions,
): BlurDecision<T> {
  // 1) 빈 입력은 판정 대상이 아니다.
  const q = raw.trim();
  if (!q) return { kind: "none", reason: "empty" };
  const qLower = q.toLowerCase();

  // 2) 코드 형태면 코드 일치만 본다. 일치가 없으면 여기서 끝 — 참조DB에 없는 코드는
  //    자유 입력 그대로 보존한다(D25). 여기서 다른 후보로 넘어가면 안 된다.
  if (CODE_RE[opts.codeLength].test(q)) {
    const byCode = results.find((r) => r.iata.toLowerCase() === qLower);
    return byCode ? { kind: "commit", item: byCode } : { kind: "none", reason: "unknown-code" };
  }

  // 후보가 아예 없는 것(no-match = 자유 입력)과 못 고르는 것(ambiguous = 골라야 함)은 안내가 다르다.
  const fallback: BlurDecision<T> = {
    kind: "none",
    reason: results.length === 0 ? "no-match" : "ambiguous",
  };

  // 3) Esc로 목록을 닫았으면 자동확정하지 않는다. (코드 확정은 2)에서 이미 처리됐다 —
  //    Esc를 눌렀더라도 코드는 확정된다.)
  if (opts.dismissed) return fallback;

  // 4) 후보가 하나뿐이면 그것.
  if (results.length === 1) return { kind: "commit", item: results[0] };

  // 5) 도시명 또는 정식 명칭이 정확일치하는 항목이 딱 하나면 그것.
  const exact = results.filter(
    (r) => (r.city ?? "").toLowerCase() === qLower || r.name.toLowerCase() === qLower,
  );
  if (exact.length === 1) return { kind: "commit", item: exact[0] };

  // 6) 그 외에는 확정하지 않는다.
  return fallback;
}
