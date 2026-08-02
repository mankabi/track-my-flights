import test from "node:test";
import assert from "node:assert/strict";
import { hostnameOf, isAllowedHostname, checkRequest } from "./guard.js";

test("hostnameOf: localhost:7470 → localhost (포트 제거)", () => {
  assert.equal(hostnameOf("localhost:7470"), "localhost");
});

test("hostnameOf: [::1]:7470 → ::1 (IPv6 대괄호 제거)", () => {
  assert.equal(hostnameOf("[::1]:7470"), "::1");
});

test("hostnameOf: 127.0.0.1 → 127.0.0.1", () => {
  assert.equal(hostnameOf("127.0.0.1"), "127.0.0.1");
});

test("hostnameOf: undefined → null", () => {
  assert.equal(hostnameOf(undefined), null);
});

test("hostnameOf: 파싱 불가(evil com) → null", () => {
  assert.equal(hostnameOf("evil com"), null);
});

test("isAllowedHostname: 기본 3종(localhost/127.0.0.1/::1) 통과", () => {
  const extra = new Set<string>();
  assert.equal(isAllowedHostname("localhost", extra), true);
  assert.equal(isAllowedHostname("127.0.0.1", extra), true);
  assert.equal(isAllowedHostname("::1", extra), true);
});

test("isAllowedHostname: evil.com 차단", () => {
  assert.equal(isAllowedHostname("evil.com", new Set<string>()), false);
});

test("isAllowedHostname: extra(myhost)로 통과", () => {
  assert.equal(isAllowedHostname("myhost", new Set(["myhost"])), true);
});

test("isAllowedHostname: 대문자 LOCALHOST도 통과(대소문자 무시)", () => {
  assert.equal(isAllowedHostname("LOCALHOST", new Set<string>()), true);
});

test("checkRequest: 정상 host + Origin 없음 → ok", () => {
  const r = checkRequest({ headers: { host: "localhost:7470" } }, new Set());
  assert.deepEqual(r, { ok: true });
});

test("checkRequest: host가 evil.com:7470 → forbidden_host", () => {
  const r = checkRequest({ headers: { host: "evil.com:7470" } }, new Set());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.equal(r.code, "forbidden_host");
  }
});

test("checkRequest: 허용 host + Origin http://localhost:5173 → ok", () => {
  const r = checkRequest(
    { headers: { host: "localhost:7470", origin: "http://localhost:5173" } },
    new Set(),
  );
  assert.deepEqual(r, { ok: true });
});

test("checkRequest: 허용 host + Origin https://evil.com → forbidden_origin", () => {
  const r = checkRequest(
    { headers: { host: "localhost:7470", origin: "https://evil.com" } },
    new Set(),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.equal(r.code, "forbidden_origin");
  }
});

test('checkRequest: Origin "null" 문자열 → forbidden_origin', () => {
  const r = checkRequest({ headers: { host: "localhost:7470", origin: "null" } }, new Set());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "forbidden_origin");
});
