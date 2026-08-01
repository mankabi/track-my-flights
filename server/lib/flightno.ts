// D24: 편명 정규화 — 순수 함수(DB 의존 없음, 테스트 가능하게).
// 대문자화·공백/하이픈 제거 후 규칙에 따라 "코드+숫자" 형태로 통일한다.
// 항공사와의 교차검증(이름 대조·자동 채움)은 server/routes.ts에서 이 함수의 결과를 사용해 수행한다.
// v1.4(D30): 에러는 한국어 문자열이 아니라 코드+params로 반환 — 클라이언트가 errors.<code> 카탈로그로 번역한다.

const CODE_NUM_RE = /^([A-Z][A-Z0-9]|[0-9][A-Z])0*(\d+[A-Z]?)$/;
const ALL_DIGITS_RE = /^\d+$/;

export type FlightNoErrorCode = "flightno_needs_airline" | "flightno_format";

export function normalizeFlightNo(
  raw: string,
  airlineIata: string | null,
):
  | { ok: true; value: string; code: string | null }
  | { ok: false; code: FlightNoErrorCode; params?: Record<string, string> } {
  const cleaned = String(raw ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");

  // 빈 값/null은 통과 (편명은 선택 항목).
  if (!cleaned) return { ok: true, value: "", code: null };

  // ① 숫자만: 항공사 코드가 있으면 접두, 없으면 에러.
  if (ALL_DIGITS_RE.test(cleaned)) {
    if (!airlineIata) {
      return { ok: false, code: "flightno_needs_airline" };
    }
    const code = airlineIata.toUpperCase();
    const num = String(Number(cleaned));
    return { ok: true, value: `${code}${num}`, code };
  }

  // ② 코드+숫자 형식: 선행 0 제거 (항공사 코드 파라미터와 무관하게 자체적으로 해석 가능).
  const m = CODE_NUM_RE.exec(cleaned);
  if (m) {
    const code = m[1];
    const rest = m[2];
    return { ok: true, value: `${code}${rest}`, code };
  }

  // ③ 그 외 형식.
  return { ok: false, code: "flightno_format", params: { raw } };
}
