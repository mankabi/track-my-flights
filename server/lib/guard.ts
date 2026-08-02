// C5 (WORKBOOK §16): DNS 리바인딩·CSRF 방어 — 순수 함수(DB/Express 의존 없음, 테스트 가능하게).
// 실제 요청에 배선하는 부분은 server/index.ts에 있다.

const DEFAULT_ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

// URL.hostname은 IPv6 리터럴을 대괄호째로 돌려준다("[::1]") — 항상 벗겨서 일관된 값으로 맞춘다.
function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

// Host 헤더에서 호스트네임만 뽑는다(포트는 버린다).
// "http://" 접두를 붙여 new URL()에 위임한다 — 콜론으로 직접 split하면 IPv6 "[::1]:7470"에서 깨진다.
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (typeof hostHeader !== "string" || hostHeader.length === 0) return null;
  try {
    return stripBrackets(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return null;
  }
}

// hostname이 허용목록(기본 3종 + extra)에 있는지 대소문자 무시하고 검사한다.
// 포트는 절대 검사하지 않는다 — Vite 프록시가 Host를 "localhost:5173"으로 넘겨도
// hostnameOf가 이미 포트를 버렸으므로 여기서는 순수 호스트네임만 비교한다.
export function isAllowedHostname(hostname: string | null, extra: ReadonlySet<string>): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return DEFAULT_ALLOWED_HOSTNAMES.has(h) || extra.has(h);
}

// D30 예외: 다른 에러 코드(not_found 등)와 달리 forbidden_host/forbidden_origin은
// web/src/i18n 카탈로그(errors.<code>)에 등재하지 않는다 — 이 403은 정상 사용 흐름에서 서버가
// 브라우저 요청 자체를 거부할 때만 발생하는 보안 거부라 정상 UI 화면에 노출될 일이 없다.
// (카탈로그 미등재 코드는 index.tsx의 t() 폴백대로 코드 문자열 그대로 표시되며, 이는 의도된 동작이다.)
export type GuardErrorCode = "forbidden_host" | "forbidden_origin";

// DNS 리바인딩·CSRF 방어 본체.
// 규칙 1(Host): hostnameOf(headers.host)가 허용목록 밖(파싱 실패 포함) → forbidden_host.
// 규칙 2(Origin): headers.origin이 존재하는 문자열이면 new URL(origin)의 hostname을 같은 허용목록으로 검사한다.
//   허용 밖(문자열 "null" 포함) 또는 파싱 불가 → forbidden_origin.
//   Origin이 아예 없으면 통과시킨다 — curl 등 비브라우저 클라이언트의 정상 경로다.
//   브라우저는 same-origin POST에도 Origin을 보내므로, 허용된 호스트네임이면 여기서 통과해야
//   폼 저장 같은 정상 요청이 깨지지 않는다.
export function checkRequest(
  req: { headers: Record<string, unknown> },
  extra: ReadonlySet<string>,
): { ok: true } | { ok: false; status: 403; code: GuardErrorCode } {
  const hostHeader = req.headers.host;
  const host = hostnameOf(typeof hostHeader === "string" ? hostHeader : undefined);
  if (!isAllowedHostname(host, extra)) {
    return { ok: false, status: 403, code: "forbidden_host" };
  }

  const originHeader = req.headers.origin;
  if (typeof originHeader === "string") {
    let originHost: string | null = null;
    try {
      originHost = stripBrackets(new URL(originHeader).hostname);
    } catch {
      originHost = null;
    }
    if (!isAllowedHostname(originHost, extra)) {
      return { ok: false, status: 403, code: "forbidden_origin" };
    }
  }

  return { ok: true };
}
