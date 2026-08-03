import test from "node:test";
import assert from "node:assert/strict";
import { decideBlurCommit, type CommitTarget } from "./autocomplete.js";

// 공항 행 픽스처 (iata / name / city).
const ap = (iata: string, name: string, city: string | null): CommitTarget => ({ iata, name, city });
// 항공사 행 픽스처 (city 없음 — CommitTarget.city는 optional).
const al = (iata: string, name: string): CommitTarget => ({ iata, name });

const AIRPORT = { codeLength: 3, dismissed: false } as const;
const AIRLINE = { codeLength: 2, dismissed: false } as const;

const JFK = ap("JFK", "John F Kennedy International Airport", "New York");
const LGA = ap("LGA", "LaGuardia Airport", "New York");
const SWF = ap("SWF", "Stewart International Airport", "New York");
const NEW = ap("NEW", "Lakefront Airport", "New Orleans");
const GMP = ap("GMP", "Gimpo International Airport", "Seoul");
const ICN = ap("ICN", "Incheon International Airport", "Seoul");
const SSN = ap("SSN", "Seoul Air Base", "Seoul");
const SEO = ap("SEO", "Seguela Airport", "Seguela");
const HND = ap("HND", "Tokyo Haneda International Airport", "Tokyo");

const KE = al("KE", "Korean Air");
const KO = al("KO", "Alaska Central Express");
const OZ = al("OZ", "Asiana Airlines");
const AZZURRA = al("ZH", "Azzurra Air");

function committedIata(d: ReturnType<typeof decideBlurCommit<CommitTarget>>): string {
  assert.equal(d.kind, "commit");
  return d.kind === "commit" ? d.item.iata : "";
}

test("trailing space + exact code commits the code on blur", () => {
  // blur 시점에는 코드 확정이 맞다 — 금지된 것은 "타이핑 중" 텍스트 치환뿐이다(D41).
  const d = decideBlurCommit("NEW ", [JFK, NEW, LGA], AIRPORT);
  assert.equal(committedIata(d), "NEW");
});

test("city name matching multiple airports does not commit", () => {
  // 도시 정확일치가 3건이라 하나를 고를 수 없다 → 사용자가 골라야 한다.
  const d = decideBlurCommit("new york", [JFK, LGA, SWF], AIRPORT);
  assert.deepEqual(d, { kind: "none", reason: "ambiguous" });
});

test("Seoul matches three airports so it stays unresolved", () => {
  // 위와 동일 — GMP/ICN/SSN 모두 city=Seoul.
  const d = decideBlurCommit("Seoul", [GMP, ICN, SSN], AIRPORT);
  assert.deepEqual(d, { kind: "none", reason: "ambiguous" });
});

test("single search result commits even without an exact name match", () => {
  // 규칙4 — 후보가 하나뿐이면 그것이 사용자의 의도다.
  const d = decideBlurCommit("Haneda", [HND], AIRPORT);
  assert.equal(committedIata(d), "HND");
});

test("lowercase code commits the matching airport", () => {
  // 코드 비교는 대소문자 무시. 대문자화는 확정 시점에만 일어난다.
  const d = decideBlurCommit("gmp", [GMP, ICN], AIRPORT);
  assert.equal(committedIata(d), "GMP");
});

test("three-letter prefix of a city commits the real airport code", () => {
  // "Seo"는 실재 코드(SEO Seguela)라 코드로 확정된다 — 문서화된 잔여 리스크(D42).
  const d = decideBlurCommit("Seo", [SEO, SSN, GMP, ICN], AIRPORT);
  assert.equal(committedIata(d), "SEO");
});

test("code-shaped input with no code match keeps the free text", () => {
  // 규칙2 — 코드 형태인데 코드 일치가 없으면 다른 후보로 넘어가지 않는다(D25).
  const d = decideBlurCommit("ZZ", [AZZURRA], AIRLINE);
  assert.deepEqual(d, { kind: "none", reason: "unknown-code" });
});

test("two-letter airline code commits the code match, not the popular carrier", () => {
  // KO는 실재 코드라 확정된다 — Korean Air로 넘어가면 안 된다.
  const d = decideBlurCommit("KO", [KO, KE], AIRLINE);
  assert.equal(committedIata(d), "KO");
});

test("full airline name with a single result commits", () => {
  const d = decideBlurCommit("Korean Air", [KE], AIRLINE);
  assert.equal(committedIata(d), "KE");
});

test("empty input never commits", () => {
  assert.deepEqual(decideBlurCommit("", [JFK, LGA], AIRPORT), { kind: "none", reason: "empty" });
  // 공백만 있는 입력도 동일.
  assert.deepEqual(decideBlurCommit("   ", [JFK, LGA], AIRPORT), { kind: "none", reason: "empty" });
});

test("dismissed dropdown blocks the ambiguous city commit", () => {
  const d = decideBlurCommit("new york", [JFK, LGA, SWF], { codeLength: 3, dismissed: true });
  assert.deepEqual(d, { kind: "none", reason: "ambiguous" });
});

test("dismissed dropdown still commits an exact code", () => {
  // 규칙3보다 규칙2가 앞선다 — Esc를 눌러도 코드는 확정된다.
  const d = decideBlurCommit("gmp", [GMP, ICN], { codeLength: 3, dismissed: true });
  assert.equal(committedIata(d), "GMP");
});

test("dismissed dropdown blocks the single-result commit", () => {
  // 규칙3이 규칙4보다 앞선다 — 사용자가 목록을 닫았으면 자동확정하지 않는다.
  const d = decideBlurCommit("Haneda", [HND], { codeLength: 3, dismissed: true });
  assert.deepEqual(d, { kind: "none", reason: "ambiguous" });
});

test("no results never commits", () => {
  // 참조DB에 후보가 없다 → 자유 입력 그대로 저장된다(D25).
  assert.deepEqual(decideBlurCommit("Sydny", [], AIRPORT), { kind: "none", reason: "no-match" });
  assert.deepEqual(decideBlurCommit("My Charter Co", [], AIRLINE), {
    kind: "none",
    reason: "no-match",
  });
});

test("code-shaped input with empty results reports unknown-code, not no-match", () => {
  // 규칙2가 먼저 걸린다 — 둘 다 자유 입력 보존이라 표시 문구는 같다.
  assert.deepEqual(decideBlurCommit("QQQ", [], AIRPORT), { kind: "none", reason: "unknown-code" });
});

test("unique exact name among several candidates commits (rule 5)", () => {
  // 후보는 4건이지만 name 정확일치는 GMP 하나뿐.
  const d = decideBlurCommit("Gimpo International Airport", [GMP, ICN, SSN, SEO], AIRPORT);
  assert.equal(committedIata(d), "GMP");
});

test("unique exact city among several candidates commits (rule 5)", () => {
  // city 정확일치가 NEW 하나뿐 — 나머지는 New York.
  const d = decideBlurCommit("new orleans", [JFK, LGA, NEW], AIRPORT);
  assert.equal(committedIata(d), "NEW");
});

test("airline name is matched case-insensitively and trimmed", () => {
  const d = decideBlurCommit("  asiana airlines  ", [OZ, KE, KO], AIRLINE);
  assert.equal(committedIata(d), "OZ");
});

test("partial airline name with several candidates does not commit", () => {
  // "Korean"은 정확일치가 아니고 후보도 2건 → 골라야 한다.
  const d = decideBlurCommit("Korean", [KE, KO], AIRLINE);
  assert.deepEqual(d, { kind: "none", reason: "ambiguous" });
});

test("alphanumeric two-character airline codes are code-shaped", () => {
  // 7C처럼 숫자를 포함한 코드도 codeLength 2 정규식에 걸린다.
  const d = decideBlurCommit("7c", [al("7C", "Jeju Air"), KE], AIRLINE);
  assert.equal(committedIata(d), "7C");
});

test("three characters are not a code for airlines", () => {
  // codeLength 2에서는 "KAL"이 코드가 아니므로 이름 규칙으로 내려간다.
  const d = decideBlurCommit("KAL", [KE], AIRLINE);
  assert.equal(committedIata(d), "KE");
});

test("null city is never treated as a match", () => {
  // 편집 모드에서 조립된 행은 city가 null일 수 있다 — 빈 문자열과 충돌하면 안 된다.
  const d = decideBlurCommit("Anytown", [ap("AAA", "Alpha Airport", null), ap("BBB", "Beta Airport", null)], AIRPORT);
  assert.deepEqual(d, { kind: "none", reason: "ambiguous" });
});
