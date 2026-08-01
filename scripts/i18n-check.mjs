#!/usr/bin/env node
// v1.4 i18n 완결성 가드 (WORKBOOK.md §14 [E]).
// web/src(단 web/src/i18n/ 제외)의 .ts/.tsx에서 주석 제거 후 한글([가-힣])이 남아있으면 실패한다.
// 주석 제거는 단순 정규식 수준(CLAUDE.md 지침 — 문자열 리터럴 안의 "//" 등 예외 케이스는 다루지 않는다).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "web", "src");
const EXCLUDE_DIR = path.join(SRC_DIR, "i18n");
const HANGUL_RE = /[가-힣]/;

/** 블록/라인 주석을 제거하되 줄바꿈은 보존해 라인 번호가 그대로 맞게 한다. */
function stripComments(code) {
  const noBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
  return noBlockComments.replace(/\/\/.*$/gm, "");
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (full === EXCLUDE_DIR) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC_DIR, []);
const offenders = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const stripped = stripComments(src);
  stripped.split("\n").forEach((line, i) => {
    if (HANGUL_RE.test(line)) {
      offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error(`i18n:check FAILED — ${offenders.length} line(s) with hardcoded Korean text remain:\n`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
} else {
  console.log(`i18n:check OK — no hardcoded Korean text found outside web/src/i18n/ (${files.length} files scanned).`);
}
