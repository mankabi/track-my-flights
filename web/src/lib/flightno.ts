// D24 클라이언트 미리보기: server/lib/flightno.ts의 "코드+숫자" 규칙(②)만 가져온다.
// 항공사 코드 접두(①)나 항공사 교차검증 같은 최종 판단은 서버가 권위를 가진다 — 여기선
// 편명 입력 UX(항공사 자동 채움, blur 미리보기 정규화)를 위한 가벼운 보조 로직만 둔다.

const CODE_NUM_RE = /^([A-Z][A-Z0-9]|[0-9][A-Z])0*(\d+[A-Z]?)$/;

/** 편명에서 항공사 코드만 추출한다 (규칙②만 — 숫자 단독 입력은 코드가 없으므로 null). */
export function extractFlightNoCode(raw: string): string | null {
  const cleaned = raw.toUpperCase().replace(/[\s-]/g, "");
  const m = CODE_NUM_RE.exec(cleaned);
  return m ? m[1] : null;
}

/** blur 시 미리보기 정규화: 규칙②에 해당하면 선행 0을 제거해 보여준다. 그 외는 정리만 하고 원문 유지. */
export function previewNormalizeFlightNo(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[\s-]/g, "");
  const m = CODE_NUM_RE.exec(cleaned);
  return m ? `${m[1]}${m[2]}` : cleaned;
}
