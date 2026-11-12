import { z } from "zod";
import { expenseCategories } from "../../src/expense-types";
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      s >= "1900-01-01" &&
      s <= "2199-12-31" &&
      !isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Enter a valid date between 1900 and 2199.",
  );
export const recurringInterval = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(6),
  z.literal(12),
]);
export const expenseSchema = z
  .object({
    description: z.string().trim().min(1).max(200),
    provider: z.string().trim().max(100),
    retailer: z.string().trim().max(100),
    category: z.enum(expenseCategories),
    amountCents: z.number().int().min(0).max(1000000000),
    date: calendarDate,
    intervalMonths: z.union([z.literal(0), recurringInterval]),
  })
  .strict();
export const scheduleSchema = expenseSchema.extend({
  intervalMonths: recurringInterval,
});
// Recalculate from the original anchor each time: Jan 31 -> Feb 28 -> Mar 31.
export function occurrenceDate(anchor: string, months: number): string {
  const [y, m, d] = anchor.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
export const expenseMigration = `CREATE TABLE expense_schedules(id TEXT PRIMARY KEY,description TEXT NOT NULL,provider TEXT NOT NULL,retailer TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('Proxy Providers','Cook Groups','Shipping Costs','My Collection','Other Expenses')),amountCents INTEGER NOT NULL CHECK(amountCents BETWEEN 0 AND 1000000000),anchorDate TEXT NOT NULL,intervalMonths INTEGER NOT NULL CHECK(intervalMonths IN(1,3,6,12)),nextIndex INTEGER NOT NULL CHECK(nextIndex>=0),active INTEGER NOT NULL CHECK(active IN(0,1)));
CREATE TABLE expenses(id TEXT PRIMARY KEY,description TEXT NOT NULL,provider TEXT NOT NULL,retailer TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('Proxy Providers','Cook Groups','Shipping Costs','My Collection','Other Expenses')),amountCents INTEGER NOT NULL CHECK(amountCents BETWEEN 0 AND 1000000000),date TEXT NOT NULL,intervalMonths INTEGER NOT NULL CHECK(intervalMonths IN(0,1,3,6,12)),scheduleId TEXT REFERENCES expense_schedules(id) ON DELETE SET NULL,UNIQUE(scheduleId,date));
CREATE INDEX expense_date_index ON expenses(date);`;
