import { describe, it, expect } from "vitest";
import { Store } from "../electron/database";
import { occurrenceDate } from "../electron/expenses/model";
import {
  parseCsv,
  parseExpenseCsv,
  exportExpenseCsv,
} from "../electron/expenses/csv";
import {
  amountToCents,
  type ExpenseInput,
  type RecurringMonths,
} from "../src/expense-types";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs from "sql.js";
const input: ExpenseInput = {
  description: "Proxy plan",
  provider: "Example provider",
  retailer: "",
  category: "Proxy Providers",
  amountCents: 12000,
  date: "2025-01-31",
  intervalMonths: 0,
};
describe("expense recurrence and financial calculations", () => {
  it("uses integer cents and preserves month-end/leap-year anchors", () => {
    expect(amountToCents("12.34")).toBe(1234);
    expect(amountToCents("0")).toBe(0);
    for (const v of ["1.005", "-1", "1e3", "NaN", "10000000.01"])
      expect(amountToCents(v)).toBeNull();
    expect(occurrenceDate("2025-01-31", 1)).toBe("2025-02-28");
    expect(occurrenceDate("2025-01-31", 2)).toBe("2025-03-31");
    expect(occurrenceDate("2024-02-29", 12)).toBe("2025-02-28");
    expect(occurrenceDate("2024-02-29", 48)).toBe("2028-02-29");
  });
  it("automatically records 1/3/6/12-month charges exactly once and persists billing cursors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toolbox-expense-"));
    const file = join(dir, "db.sqlite");
    let db = await Store.open(file);
    try {
      for (const intervalMonths of [1, 3, 6, 12] as RecurringMonths[])
        db.expenses.create({ ...input, intervalMonths }, "2026-02-28");
      const state = db.expenses.state("2026-02-28");
      expect(state.entries).toHaveLength(24);
      expect(state.totalCents).toBe(288000);
      expect(state.monthCents).toBe(12000);
      expect(state.monthlyRecurringCents).toBe(19000);
      const ids = state.entries.map((e) => e.id);
      db.expenses.state("2026-02-28");
      db.close();
      db = await Store.open(file);
      expect(db.expenses.state("2026-02-28").entries.map((e) => e.id)).toEqual(
        ids,
      );
      expect(db.snapshot().orders).toHaveLength(36);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("excludes future charges from spending until their due date", async () => {
    const db = await Store.open();
    try {
      const a = db.expenses.create(
        { ...input, date: "2026-03-15", intervalMonths: 1 },
        "2026-02-28",
      );
      expect(a.totalCents).toBe(0);
      expect(a.entries).toHaveLength(1);
      expect(db.expenses.state("2026-03-15").totalCents).toBe(12000);
      expect(db.expenses.state("2026-04-15").entries).toHaveLength(2);
    } finally {
      db.close();
    }
  });
  it("separates logged-charge edits from future schedule edits and keeps history when stopped", async () => {
    const db = await Store.open();
    try {
      let state = db.expenses.create(
        { ...input, amountCents: 1000, date: "2026-01-01", intervalMonths: 1 },
        "2026-03-01",
      );
      const original = state.entries.find((e) => e.date === "2026-01-01")!;
      db.expenses.update(
        {
          id: original.id,
          expense: {
            ...input,
            amountCents: 2500,
            date: original.date,
            intervalMonths: 1,
          },
        },
        "2026-03-01",
      );
      state = db.expenses.state("2026-03-01");
      expect(state.totalCents).toBe(4500);
      expect(state.schedules[0].amountCents).toBe(1000);
      const id = state.schedules[0].id;
      state = db.expenses.updateSchedule(
        {
          id,
          schedule: {
            ...input,
            amountCents: 2000,
            date: "2026-04-15",
            intervalMonths: 3,
          },
        },
        "2026-03-01",
      );
      expect(state.totalCents).toBe(4500);
      expect(state.schedules[0].nextDue).toBe("2026-04-15");
      expect(db.expenses.state("2026-04-15").totalCents).toBe(6500);
      expect(db.expenses.state("2026-07-15").totalCents).toBe(8500);
      db.expenses.stopSchedule(id, "2026-07-15");
      state = db.expenses.state("2026-10-15");
      expect(state.entries).toHaveLength(5);
      expect(state.totalCents).toBe(8500);
      expect(state.monthlyRecurringCents).toBe(0);
      expect(() =>
        db.expenses.updateSchedule(
          { id, schedule: { ...input, date: "2026-01-01", intervalMonths: 1 } },
          "2026-10-15",
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });
  it("does not recreate deleted historical charges, and delete-all removes future schedules", async () => {
    const db = await Store.open();
    try {
      const state = db.expenses.create(
        { ...input, date: "2026-01-01", intervalMonths: 1 },
        "2026-03-01",
      );
      db.expenses.remove(
        { id: state.entries[0].id, stopSeries: false },
        "2026-03-01",
      );
      expect(db.expenses.state("2026-03-01").entries).toHaveLength(2);
      expect(db.expenses.state("2026-04-01").entries).toHaveLength(3);
      db.expenses.clear("2026-04-01");
      expect(db.expenses.state("2027-04-01").entries).toEqual([]);
      expect(db.expenses.state("2027-04-01").schedules).toEqual([]);
    } finally {
      db.close();
    }
  });
  it("validates expenses and rolls back memory/disk on persistence failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toolbox-expense-fail-"));
    const file = join(dir, "db.sqlite");
    const db = await Store.open(file);
    try {
      for (const change of [
        { amountCents: 1.5 },
        { amountCents: -1 },
        { intervalMonths: 2 },
        { category: "Invalid" },
        { date: "2026-02-31" },
        { description: "" },
      ])
        expect(() =>
          db.expenses.create({ ...input, ...change }, "2026-02-28"),
        ).toThrow();
      mkdirSync(file + ".tmp");
      expect(() => db.expenses.create(input, "2026-02-28")).toThrow();
      expect(db.expenses.state("2026-02-28").entries).toEqual([]);
      const reopened = await Store.open(file);
      expect(reopened.expenses.state("2026-02-28").entries).toEqual([]);
      reopened.close();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("expense CSV", () => {
  it("parses quoted commas/newlines/BOM and rejects malformed files", () => {
    expect(
      parseCsv('\uFEFFa,b\r\n"line\nnext","quote ""two"", three"'),
    ).toEqual([
      ["a", "b"],
      ["line\nnext", 'quote "two", three'],
    ]);
    for (const text of ['a\n"unfinished', 'a\n"closed"oops', 'a\nab"cd'])
      expect(() => parseCsv(text)).toThrow();
    const csv =
      'description,provider,retailer,category,amount,date,recurring_months\n"Plan, premium",Store,,proxy providers,12.34,2026-01-01,3';
    const parsed = parseExpenseCsv(csv);
    expect(parsed.entries[0]).toMatchObject({
      description: "Plan, premium",
      amountCents: 1234,
      intervalMonths: 3,
      category: "Proxy Providers",
    });
    expect(() => parseExpenseCsv(csv.replace("12.34", "12.345"))).toThrow(
      "row 2",
    );
  });
  it("round-trips charges and schedules, skips existing IDs, and imports atomically", async () => {
    const a = await Store.open();
    const b = await Store.open();
    try {
      const state = a.expenses.create(
        { ...input, intervalMonths: 3 },
        "2026-02-28",
      );
      const csv = exportExpenseCsv(state);
      const parsed = parseExpenseCsv(csv);
      const restored = b.expenses.import(parsed, "2026-02-28");
      expect(restored.state.totalCents).toBe(state.totalCents);
      expect(restored.state.entries).toHaveLength(state.entries.length);
      expect(restored.state.schedules[0].nextDue).toBe(
        state.schedules[0].nextDue,
      );
      const duplicate = b.expenses.import(parsed, "2026-02-28");
      expect(duplicate.added).toBe(0);
      expect(duplicate.state.entries).toHaveLength(state.entries.length);
      const bad = {
        ...parsed,
        entries: [
          { ...input, archived: true },
          {
            ...parsed.entries[0],
            id: undefined,
            scheduleId: "11111111-1111-4111-8111-111111111111",
          },
        ],
      };
      expect(() => b.expenses.import(bad, "2026-02-28")).toThrow();
      expect(b.expenses.state("2026-02-28").entries).toHaveLength(
        state.entries.length,
      );
      a.expenses.create(
        { ...input, description: "=DANGEROUS()", intervalMonths: 0 },
        "2026-02-28",
      );
      expect(exportExpenseCsv(a.expenses.state("2026-02-28"))).toContain(
        "'=DANGEROUS()",
      );
    } finally {
      a.close();
      b.close();
    }
  });
});
it("migrates v0.2.1 data without losing connected inbox settings or orders", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-expense-migrate-"));
  const file = join(dir, "db.sqlite");
  try {
    let db = await Store.open(file);
    db.connectInbox("test@gmail.com", {
      events: [],
      scanned: 0,
      skipped: 0,
      limited: false,
    });
    db.setInboxAuto(true);
    const ids = db.snapshot().orders.map((o) => o.id);
    db.close();
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const v3 = new SQL.Database(readFileSync(file));
    v3.run(
      "DROP TABLE expenses; DROP TABLE expense_schedules; DELETE FROM migrations WHERE version=4",
    );
    writeFileSync(file, v3.export());
    v3.close();
    db = await Store.open(file);
    expect(db.inboxAccount()).toMatchObject({
      email: "test@gmail.com",
      auto: true,
    });
    expect(db.snapshot().orders.map((o) => o.id)).toEqual(ids);
    expect(db.expenses.state("2026-02-28").entries).toEqual([]);
    db.close();
    expect(
      readFileSync(file + ".pre-expenses-v3.bak").byteLength,
    ).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("processes large missed-charge backlogs in bounded batches and normalizes cents after summing", async () => {
  const db = await Store.open();
  try {
    const parsed = parseExpenseCsv(
      "description,category,amount,date,recurring_months\n" +
        Array.from(
          { length: 4 },
          (_, i) => `Historical plan ${i},Other Expenses,0.01,1900-01-31,1`,
        ).join("\n"),
    );
    const first = db.expenses.import(parsed, "2026-02-28");
    expect(first.state.catchUpRemaining).toBe(true);
    expect(first.state.entries).toHaveLength(5004);
    const complete = db.expenses.state("2026-02-28");
    expect(complete.entries).toHaveLength(6056);
    expect(complete.catchUpRemaining).toBe(false);
    expect(new Set(complete.entries.map((e) => e.id)).size).toBe(6056);
    db.expenses.clear("2026-02-28");
    for (let i = 0; i < 2; i++)
      db.expenses.create(
        { ...input, amountCents: 10, intervalMonths: 3, date: "2026-02-28" },
        "2026-02-28",
      );
    expect(db.expenses.state("2026-02-28").monthlyRecurringCents).toBe(7);
  } finally {
    db.close();
  }
});
it("settles an individual recurring backlog before stopping a series during catch-up", async () => {
  const db = await Store.open();
  try {
    const parsed = parseExpenseCsv(
      "description,category,amount,date,recurring_months\n" +
        Array.from(
          { length: 7 },
          (_, i) => `Long history ${i},Other Expenses,0.01,1900-01-31,1`,
        ).join("\n"),
    );
    const first = db.expenses.import(parsed, "2026-02-28");
    const last = first.state.schedules.at(-1)!;
    const stopped = db.expenses.stopSchedule(last.id, "2026-02-28");
    expect(
      stopped.entries.filter((e) => e.scheduleId === last.id),
    ).toHaveLength(1514);
    expect(stopped.schedules.find((s) => s.id === last.id)?.active).toBe(false);
  } finally {
    db.close();
  }
});
