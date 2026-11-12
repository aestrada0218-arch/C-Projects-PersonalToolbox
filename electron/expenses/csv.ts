import { z } from "zod";
import {
  expenseCategories,
  amountToCents,
  type ExpenseInput,
  type ExpenseSchedule,
  type ExpenseState,
} from "../../src/expense-types";
import { expenseSchema, recurringInterval } from "./model";
export type ImportedCharge = ExpenseInput & {
  id?: string;
  scheduleId?: string | null;
  archived: boolean;
};
export type ParsedExpenseCsv = {
  entries: ImportedCharge[];
  schedules: ExpenseSchedule[];
};
const headers = [
  "record_type",
  "id",
  "description",
  "provider",
  "retailer",
  "category",
  "amount",
  "date",
  "recurring_months",
  "schedule_id",
  "active",
  "next_index",
];
export function parseCsv(text: string): string[][] {
  if (Buffer.byteLength(text, "utf8") > 8 * 1024 * 1024)
    throw Error("CSV is limited to 8 MiB.");
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const cell = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some((s) => s.trim())) rows.push(row);
    row = [];
    if (rows.length > 20001) throw Error("CSV is limited to 20,000 records.");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) throw Error("Malformed CSV quoting.");
      quoted = true;
      continue;
    }
    if (c === ",") {
      cell();
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line();
      continue;
    }
    if (closed) throw Error("Unexpected characters after a CSV quote.");
    field += c;
  }
  if (quoted) throw Error("Unclosed CSV quote.");
  if (field || row.length || closed) line();
  return rows;
}
export function parseExpenseCsv(text: string): ParsedExpenseCsv {
  const rows = parseCsv(text);
  if (!rows.length) throw Error("CSV is empty.");
  const cols = rows.shift()!.map((s) => s.trim().toLowerCase());
  if (new Set(cols).size !== cols.length)
    throw Error("CSV contains duplicate column names.");
  for (const required of ["description", "category", "amount", "date"])
    if (!cols.includes(required))
      throw Error("Missing CSV column: " + required + ".");
  const result: ParsedExpenseCsv = { entries: [], schedules: [] };
  const ids = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    try {
      const values = rows[index];
      if (values.length !== cols.length) throw Error();
      const row = Object.fromEntries(cols.map((c, i) => [c, values[i]]));
      const amount = amountToCents(row.amount);
      if (amount === null) throw Error();
      const category = expenseCategories.find(
        (c) => c.toLowerCase() === row.category.trim().toLowerCase(),
      );
      const input = expenseSchema.parse({
        description: row.description,
        provider: row.provider || "",
        retailer: row.retailer || "",
        category,
        amountCents: amount,
        date: row.date.trim(),
        intervalMonths: Number(row.recurring_months || 0),
      });
      const kind = (row.record_type || "").trim();
      if (kind && !["charge", "schedule"].includes(kind)) throw Error();
      const id = row.id?.trim()
        ? z.string().uuid().parse(row.id.trim()).toLowerCase()
        : undefined;
      if (id) {
        if (ids.has(id)) throw Error();
        ids.add(id);
      }
      if (kind === "schedule") {
        if (!id) throw Error();
        const intervalMonths = recurringInterval.parse(input.intervalMonths);
        const nextIndex = z
          .number()
          .int()
          .min(0)
          .max(3600)
          .parse(Number(row.next_index || 0));
        const active = row.active?.trim().toLowerCase() || "1";
        if (!["1", "0", "true", "false"].includes(active)) throw Error();
        result.schedules.push({
          id,
          description: input.description,
          provider: input.provider,
          retailer: input.retailer,
          category: input.category,
          amountCents: input.amountCents,
          anchorDate: input.date,
          intervalMonths,
          nextIndex,
          active: active === "1" || active === "true",
          nextDue: "",
        });
      } else {
        const scheduleId = row.schedule_id?.trim()
          ? z.string().uuid().parse(row.schedule_id.trim()).toLowerCase()
          : null;
        if (kind !== "charge" && scheduleId) throw Error();
        result.entries.push({
          ...input,
          id,
          scheduleId,
          archived: kind === "charge",
        });
      }
    } catch {
      throw Error(
        `CSV row ${index + 2} is invalid. Check category, two-decimal amount, YYYY-MM-DD date, unique IDs, and recurring_months (0, 1, 3, 6, or 12).`,
      );
    }
  }
  if (!result.entries.length && !result.schedules.length)
    throw Error("CSV contains no records.");
  return result;
}
function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^\s*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function exportExpenseCsv(state: ExpenseState) {
  const rows: unknown[][] = [];
  for (const s of state.schedules)
    rows.push([
      "schedule",
      s.id,
      s.description,
      s.provider,
      s.retailer,
      s.category,
      (s.amountCents / 100).toFixed(2),
      s.anchorDate,
      s.intervalMonths,
      "",
      Number(s.active),
      s.nextIndex,
    ]);
  for (const e of state.entries)
    rows.push([
      "charge",
      e.id,
      e.description,
      e.provider,
      e.retailer,
      e.category,
      (e.amountCents / 100).toFixed(2),
      e.date,
      e.intervalMonths,
      e.scheduleId || "",
      "",
      "",
    ]);
  return (
    "\uFEFF" +
    [
      headers.map(csvCell).join(","),
      ...rows.map((row) => row.map(csvCell).join(",")),
    ].join("\r\n")
  );
}
