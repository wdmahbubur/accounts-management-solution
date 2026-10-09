import assert from "node:assert/strict";
import test from "node:test";
import { parseBalanceSheetDates } from "../../apps/web/app/o/[organizationId]/reports/balance-sheet/date-filters.ts";

test("opening Balance Sheet without comparison uses the supplied local today or selected date", () => {
  assert.deepEqual(parseBalanceSheetDates({}, "2026-10-09"), { asOf: "2026-10-09", comparisonAsOf: null });
  assert.deepEqual(parseBalanceSheetDates({ as_of: "2026-09-30" }, "2026-10-09"), { asOf: "2026-09-30", comparisonAsOf: null });
});

test("submitting the GET form with its optional comparison input blank keeps the report runnable", () => {
  const query = Object.fromEntries(new URLSearchParams("as_of=2026-10-09&comparison_as_of="));
  assert.deepEqual(parseBalanceSheetDates(query, "2026-10-10"), { asOf: "2026-10-09", comparisonAsOf: null });
});

test("valid comparison dates preserve the selected dates including a real leap day", () => {
  assert.deepEqual(parseBalanceSheetDates({ as_of: "2026-10-09", comparison_as_of: "2024-02-29" }, "2026-10-10"),
    { asOf: "2026-10-09", comparisonAsOf: "2024-02-29" });
  assert.equal(parseBalanceSheetDates({ as_of: "2026-10-09", comparison_as_of: "2026-10-09" }, "2026-10-10"), null);
});

test("malformed provided dates and ambiguous repeated values are rejected instead of silently omitted", () => {
  for (const comparison_as_of of ["2026-02-29", "2026-04-31", "2026-13-01", "not-a-date", " ", "2026-10-08T00:00:00Z", ["2026-10-07", "2026-10-08"]]) {
    assert.equal(parseBalanceSheetDates({ as_of: "2026-10-09", comparison_as_of }, "2026-10-10"), null);
  }
  for (const as_of of ["", "2026-02-30", "not-a-date", ["2026-10-08", "2026-10-09"]]) {
    assert.equal(parseBalanceSheetDates({ as_of }, "2026-10-10"), null);
  }
});
