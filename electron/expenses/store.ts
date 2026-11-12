import type { Database, SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Expense,
  ExpenseInput,
  ExpenseSchedule,
  ExpenseState,
} from "../../src/expense-types";
import {
  expenseSchema,
  scheduleSchema,
  calendarDate,
  occurrenceDate,
} from "./model";
import type { ParsedExpenseCsv } from "./csv";
export class ExpenseRepository {
  constructor(
    private db: () => Database,
    private transaction: <T>(fn: () => T) => T,
  ) {}
  private rows(table: "expenses" | "expense_schedules") {
    const result = this.db().exec(`SELECT * FROM ${table}`)[0];
    return result
      ? result.values.map((row) =>
          Object.fromEntries(result.columns.map((c, i) => [c, row[i]])),
        )
      : [];
  }
  private schedules(): ExpenseSchedule[] {
    return this.rows("expense_schedules").map((row) => ({
      ...row,
      active: Boolean(row.active),
      nextDue: occurrenceDate(
        String(row.anchorDate),
        Number(row.intervalMonths) * Number(row.nextIndex),
      ),
    })) as unknown as ExpenseSchedule[];
  }
  private insertCharge(
    input: ExpenseInput,
    id: string = randomUUID(),
    scheduleId: string | null = null,
  ) {
    this.db().run(
      "INSERT INTO expenses(id,description,provider,retailer,category,amountCents,date,intervalMonths,scheduleId) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        id,
        input.description,
        input.provider,
        input.retailer,
        input.category,
        input.amountCents,
        input.date,
        input.intervalMonths,
        scheduleId,
      ],
    );
  }
  private add(input: ExpenseInput, id: string = randomUUID()) {
    let scheduleId: string | null = null;
    if (input.intervalMonths) {
      scheduleId = randomUUID();
      this.db().run(
        "INSERT INTO expense_schedules VALUES(?,?,?,?,?,?,?,?,?,1)",
        [
          scheduleId,
          input.description,
          input.provider,
          input.retailer,
          input.category,
          input.amountCents,
          input.date,
          input.intervalMonths,
          1,
        ],
      );
    }
    this.insertCharge(input, id, scheduleId);
  }
  private catchUp(today: string, onlyId?: string) {
    let count = 0;
    for (const s of this.schedules().filter(
      (s) => s.active && (!onlyId || s.id === onlyId),
    )) {
      let index = s.nextIndex;
      let next = occurrenceDate(s.anchorDate, index * s.intervalMonths);
      while (next <= today && count < 5000) {
        this.db().run(
          "INSERT INTO expenses(id,description,provider,retailer,category,amountCents,date,intervalMonths,scheduleId) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(scheduleId,date) DO NOTHING",
          [
            randomUUID(),
            s.description,
            s.provider,
            s.retailer,
            s.category,
            s.amountCents,
            next,
            s.intervalMonths,
            s.id,
          ],
        );
        index++;
        count++;
        next = occurrenceDate(s.anchorDate, index * s.intervalMonths);
      }
      if (index !== s.nextIndex)
        this.db().run("UPDATE expense_schedules SET nextIndex=? WHERE id=?", [
          index,
          s.id,
        ]);
      if (count >= 5000) break;
    }
  }
  state(today: string): ExpenseState {
    calendarDate.parse(today);
    if (this.schedules().some((s) => s.active && s.nextDue <= today))
      this.transaction(() => this.catchUp(today));
    return this.snapshot(today);
  }
  private snapshot(today: string): ExpenseState {
    const entries = this.rows("expenses").sort(
      (a, b) =>
        String(b.date).localeCompare(String(a.date)) ||
        String(a.id).localeCompare(String(b.id)),
    ) as unknown as Expense[];
    const schedules = this.schedules();
    const posted = entries.filter((e) => e.date <= today);
    return {
      entries,
      schedules,
      today,
      totalCents: posted.reduce((n, e) => n + e.amountCents, 0),
      monthCents: posted
        .filter((e) => e.date.slice(0, 7) === today.slice(0, 7))
        .reduce((n, e) => n + e.amountCents, 0),
      monthlyRecurringCents: Math.round(
        schedules
          .filter((s) => s.active)
          .reduce((n, s) => n + s.amountCents / s.intervalMonths, 0),
      ),
      catchUpRemaining: schedules.some((s) => s.active && s.nextDue <= today),
    };
  }
  create(input: unknown, today: string) {
    const parsed = expenseSchema.parse(input);
    this.transaction(() => {
      this.add(parsed);
      this.catchUp(today);
    });
    return this.snapshot(today);
  }
  update(input: unknown, today: string) {
    const { id, expense } = z
      .object({ id: z.string().uuid(), expense: expenseSchema })
      .strict()
      .parse(input);
    this.state(today);
    this.transaction(() => {
      const previous = this.rows("expenses").find((e) => e.id === id);
      if (!previous) throw Error("Expense missing");
      if (expense.intervalMonths !== Number(previous.intervalMonths))
        throw Error("Edit the recurring schedule separately");
      this.db().run(
        "UPDATE expenses SET description=?,provider=?,retailer=?,category=?,amountCents=?,date=? WHERE id=?",
        [
          expense.description,
          expense.provider,
          expense.retailer,
          expense.category,
          expense.amountCents,
          expense.date,
          id,
        ],
      );
    });
    return this.snapshot(today);
  }
  updateSchedule(input: unknown, today: string) {
    const { id, schedule } = z
      .object({ id: z.string().uuid(), schedule: scheduleSchema })
      .strict()
      .parse(input);
    if (schedule.date < today)
      throw Error("The next billing date cannot be in the past");
    this.state(today);
    this.transaction(() => {
      if (!this.schedules().some((s) => s.id === id && s.active))
        throw Error("Schedule missing");
      this.catchUp(today, id);
      this.db().run(
        "UPDATE expense_schedules SET description=?,provider=?,retailer=?,category=?,amountCents=?,anchorDate=?,intervalMonths=?,nextIndex=0 WHERE id=?",
        [
          schedule.description,
          schedule.provider,
          schedule.retailer,
          schedule.category,
          schedule.amountCents,
          schedule.date,
          schedule.intervalMonths,
          id,
        ],
      );
      this.catchUp(today);
    });
    return this.snapshot(today);
  }
  stopSchedule(id: unknown, today: string) {
    const key = z.string().uuid().parse(id);
    this.state(today);
    this.transaction(() => {
      this.catchUp(today, key);
      this.db().run("UPDATE expense_schedules SET active=0 WHERE id=?", [key]);
    });
    return this.snapshot(today);
  }
  remove(input: unknown, today: string) {
    const { id, stopSeries } = z
      .object({ id: z.string().uuid(), stopSeries: z.boolean() })
      .strict()
      .parse(input);
    this.state(today);
    this.transaction(() => {
      const row = this.rows("expenses").find((e) => e.id === id);
      if (!row) throw Error("Expense missing");
      if (stopSeries && row.scheduleId) {
        this.catchUp(today, String(row.scheduleId));
        this.db().run("UPDATE expense_schedules SET active=0 WHERE id=?", [
          String(row.scheduleId),
        ]);
      }
      this.db().run("DELETE FROM expenses WHERE id=?", [id]);
    });
    return this.snapshot(today);
  }
  clear(today: string) {
    this.transaction(() =>
      this.db().run("DELETE FROM expenses; DELETE FROM expense_schedules"),
    );
    return this.snapshot(today);
  }
  import(parsed: ParsedExpenseCsv, today: string) {
    let added = 0;
    let skipped = 0;
    this.transaction(() => {
      const knownSchedules = new Set(this.schedules().map((s) => s.id));
      for (const schedule of parsed.schedules) {
        if (knownSchedules.has(schedule.id)) {
          skipped++;
          continue;
        }
        this.db().run(
          "INSERT INTO expense_schedules VALUES(?,?,?,?,?,?,?,?,?,?)",
          [
            schedule.id,
            schedule.description,
            schedule.provider,
            schedule.retailer,
            schedule.category,
            schedule.amountCents,
            schedule.anchorDate,
            schedule.intervalMonths,
            schedule.nextIndex,
            Number(schedule.active),
          ],
        );
        knownSchedules.add(schedule.id);
      }
      const knownEntries = new Set(
        this.rows("expenses").map((e) => String(e.id)),
      );
      for (const row of parsed.entries) {
        if (row.id && knownEntries.has(row.id)) {
          skipped++;
          continue;
        }
        if (row.scheduleId) {
          if (!knownSchedules.has(row.scheduleId))
            throw Error("CSV references a missing recurring schedule");
          this.insertCharge(row, row.id || randomUUID(), row.scheduleId);
        } else if (row.archived) this.insertCharge(row, row.id || randomUUID());
        else this.add(row, row.id || randomUUID());
        if (row.id) knownEntries.add(row.id);
        added++;
      }
      this.catchUp(today);
    });
    return { state: this.snapshot(today), added, skipped };
  }
}
