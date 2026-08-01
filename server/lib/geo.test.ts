import test from "node:test";
import assert from "node:assert/strict";
import { haversineKm, classifyFlight, durationMinutes, addDays } from "./geo.js";

test("haversine GMP-HND는 FM값(1,182km) 근방", () => {
  const km = haversineKm(37.5583, 126.791, 35.552258, 139.779694);
  assert.ok(Math.abs(km - 1182) < 40, `got ${km}`);
});

test("haversine PUS-GMP는 FM값(327km) 근방", () => {
  const km = haversineKm(35.179501, 128.938278, 37.5583, 126.791);
  assert.ok(Math.abs(km - 327) < 20, `got ${km}`);
});

test("D11 분류: 같은 나라=국내, 같은 대륙=대륙내, 그 외=대륙간", () => {
  const KR = { country_code: "KR", continent: "AS" };
  const JP = { country_code: "JP", continent: "AS" };
  const US = { country_code: "US", continent: "NA" };
  const MP = { country_code: "MP", continent: "OC" };
  assert.equal(classifyFlight(KR, KR), "domestic");
  assert.equal(classifyFlight(KR, JP), "intra");
  assert.equal(classifyFlight(KR, US), "inter");
  assert.equal(classifyFlight(KR, MP), "inter");
  assert.equal(classifyFlight(US, US), "domestic");
  assert.equal(classifyFlight({ country_code: null, continent: null }, KR), null);
});

test("소요시간: ICN 14:30 → LAX 09:40 같은 날짜 = 11:10 (FM #42)", () => {
  const min = durationMinutes("2019-04-27", "14:30", "Asia/Seoul", "09:40", "America/Los_Angeles", 0);
  assert.equal(min, 670);
});

test("소요시간: ICN 21:30 → BKK 01:30 +1 = 6:00 (FM #22)", () => {
  const min = durationMinutes("2018-06-06", "21:30", "Asia/Seoul", "01:30", "Asia/Bangkok", 1);
  assert.equal(min, 360);
});

test("소요시간: GMP 09:00 → HND 11:05 = 2:05 (FM #71)", () => {
  const min = durationMinutes("2019-12-11", "09:00", "Asia/Seoul", "11:05", "Asia/Tokyo", 0);
  assert.equal(min, 125);
});

test("addDays 경계", () => {
  assert.equal(addDays("2019-12-31", 1), "2020-01-01");
  assert.equal(addDays("2020-03-01", -1), "2020-02-29");
});
