// [C2-b] (WORKBOOK §16): shared row-level validation for migration importers (import-json.ts,
// import-fr24.ts). Pure function — no DB / better-sqlite3 import — so it can be unit-tested without a
// database and reused by every importer that ultimately targets the flights table's CHECK constraints
// (server/db.ts). Collects every problem in a row instead of throwing on the first one, so a
// hand-edited or converted file reports all N mistakes in a single pass instead of N runs.
//
// Contract: callers apply their own field mapping/defaulting first (e.g. `flight_role ?? "passenger"`,
// empty-string-to-null), then pass the result here. That is why flight_role has no "or null" branch
// below — the DB column is NOT NULL DEFAULT 'passenger', so a null reaching this function means the
// caller forgot to default it, and that is exactly the bug this should catch.

export interface RowIssue {
  row: number;
  field: string;
  value: unknown;
  problem: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IATA_RE = /^[A-Za-z]{3}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const SEAT_POS_VALUES = ["window", "aisle", "middle"] as const;
const TRAVEL_CLASS_VALUES = ["economy", "economyplus", "business", "first", "private"] as const;
const FLIGHT_ROLE_VALUES = ["passenger", "crew", "cockpit"] as const;
const FLIGHT_REASON_VALUES = ["personal", "business", "virtual"] as const;

/**
 * Validate one already-mapped row against the flights table's constraints.
 * `row` is a loose bag of fields (not the DB row type) since each importer's pre-mapping shape differs
 * slightly; `index` is whatever row number the caller wants echoed back in RowIssue.row (1-based row
 * index for JSON arrays, CSV line number for import-fr24, etc).
 */
export function validateRow(row: Record<string, unknown>, index: number): RowIssue[] {
  const issues: RowIssue[] = [];
  const add = (field: string, value: unknown, problem: string) => issues.push({ row: index, field, value, problem });

  if (typeof row.date !== "string" || !DATE_RE.test(row.date)) {
    add("date", row.date, "must be YYYY-MM-DD");
  }
  for (const field of ["dep_iata", "arr_iata"] as const) {
    const v = row[field];
    if (typeof v !== "string" || !IATA_RE.test(v)) {
      add(field, v, "must be a 3-letter IATA code");
    }
  }
  for (const field of ["dep_time", "arr_time"] as const) {
    const v = row[field];
    if (v != null && (typeof v !== "string" || !TIME_RE.test(v))) {
      add(field, v, "must be null or HH:MM");
    }
  }
  if (!Number.isInteger(row.arr_day_offset)) {
    add("arr_day_offset", row.arr_day_offset, "must be an integer");
  }

  checkEnum(issues, index, "seat_pos", row.seat_pos, SEAT_POS_VALUES, true);
  checkEnum(issues, index, "travel_class", row.travel_class, TRAVEL_CLASS_VALUES, true);
  checkEnum(issues, index, "flight_role", row.flight_role, FLIGHT_ROLE_VALUES, false);
  checkEnum(issues, index, "flight_reason", row.flight_reason, FLIGHT_REASON_VALUES, true);

  for (const field of ["distance_km", "duration_min"] as const) {
    const v = row[field];
    if (v != null && (typeof v !== "number" || !Number.isInteger(v) || v < 0)) {
      add(field, v, "must be null or a non-negative integer");
    }
  }

  return issues;
}

function checkEnum(
  issues: RowIssue[],
  row: number,
  field: string,
  value: unknown,
  allowed: readonly string[],
  allowNull: boolean,
): void {
  if (value == null) {
    if (!allowNull) issues.push({ row, field, value, problem: `must be one of ${allowed.join("/")}` });
    return;
  }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    issues.push({
      row,
      field,
      value,
      problem: `must be one of ${allowed.join("/")}${allowNull ? " or null" : ""}`,
    });
  }
}

/** Render a list of issues as a plain-text table (used by both importers' CLI output). */
export function formatIssuesTable(issues: RowIssue[]): string {
  if (issues.length === 0) return "";
  const rows = issues.map((i) => ({ row: i.row, field: i.field, value: JSON.stringify(i.value), problem: i.problem }));
  const cols: (keyof (typeof rows)[number])[] = ["row", "field", "value", "problem"];
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i])).join("  ");
  const out = [line(cols), line(widths.map((w) => "-".repeat(w)))];
  for (const r of rows) out.push(line(cols.map((c) => String(r[c]))));
  return out.join("\n");
}
