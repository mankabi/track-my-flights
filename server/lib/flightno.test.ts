import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFlightNo } from "./flightno.js";

test("KE0694 → KE694 (선행 0 제거)", () => {
  const r = normalizeFlightNo("KE0694", null);
  assert.deepEqual(r, { ok: true, value: "KE694", code: "KE" });
});

test("ke 1246 → KE1246 (소문자·공백 정규화)", () => {
  const r = normalizeFlightNo("ke 1246", null);
  assert.deepEqual(r, { ok: true, value: "KE1246", code: "KE" });
});

test("7C1302는 불변", () => {
  const r = normalizeFlightNo("7C1302", null);
  assert.deepEqual(r, { ok: true, value: "7C1302", code: "7C" });
});

test("숫자만 입력 + 항공사 코드 있음 → 접두 (014+KE→KE14)", () => {
  const r = normalizeFlightNo("014", "KE");
  assert.deepEqual(r, { ok: true, value: "KE14", code: "KE" });
});

test("숫자만 입력 + 항공사 미해석 → 에러 코드 flightno_needs_airline", () => {
  const r = normalizeFlightNo("014", null);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "flightno_needs_airline");
});

test("JL005 → JL5 (항공사 파라미터 없이도 규칙②만으로 해석)", () => {
  const r = normalizeFlightNo("JL005", null);
  assert.deepEqual(r, { ok: true, value: "JL5", code: "JL" });
});

test("빈 값/null은 통과", () => {
  const r1 = normalizeFlightNo("", null);
  assert.equal(r1.ok, true);
  if (r1.ok) assert.equal(r1.code, null);

  const r2 = normalizeFlightNo(null as unknown as string, null);
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.code, null);
});

test("인식 불가 형식(ABC!) → 에러 코드 flightno_format", () => {
  const r = normalizeFlightNo("ABC!", null);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "flightno_format");
    assert.equal(r.params?.raw, "ABC!");
  }
});

test("하이픈 포함 입력도 정규화 (7C-1302)", () => {
  const r = normalizeFlightNo("7C-1302", null);
  assert.deepEqual(r, { ok: true, value: "7C1302", code: "7C" });
});
