export const expenseCategories = [
  "Proxy Providers",
  "Cook Groups",
  "Shipping Costs",
  "My Collection",
  "Other Expenses",
] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];
export type RecurringMonths = 0 | 1 | 3 | 6 | 12;
export type ExpenseInput = {
  description: string;
  provider: string;
  retailer: string;
  category: ExpenseCategory;
  amountCents: number;
  date: string;
  intervalMonths: RecurringMonths;
};
export type Expense = ExpenseInput & { id: string; scheduleId: string | null };
export type ExpenseSchedule = {
  id: string;
  description: string;
  provider: string;
  retailer: string;
  category: ExpenseCategory;
  amountCents: number;
  anchorDate: string;
  intervalMonths: Exclude<RecurringMonths, 0>;
  nextIndex: number;
  active: boolean;
  nextDue: string;
};
export type ScheduleInput = Omit<ExpenseInput, "intervalMonths"> & {
  intervalMonths: Exclude<RecurringMonths, 0>;
};
export type ExpenseState = {
  entries: Expense[];
  schedules: ExpenseSchedule[];
  totalCents: number;
  monthCents: number;
  monthlyRecurringCents: number;
  today: string;
  catchUpRemaining: boolean;
};
export type ExpenseResult = {
  ok: boolean;
  state: ExpenseState;
  error?: string;
  added?: number;
  skipped?: number;
};
export type ExpenseImportPreview = {
  cancelled?: boolean;
  error?: string;
  token?: string;
  charges?: number;
  schedules?: number;
  newRecurring?: number;
};
export type ExpenseExportResult = {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
};
export const intervalLabel = (months: number) =>
  ({
    0: "One-time",
    1: "Every month",
    3: "Every 3 months",
    6: "Every 6 months",
    12: "Yearly",
  })[months] || "One-time";
export function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function amountToCents(value: string): number | null {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [a, b = ""] = value.trim().split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  return Number.isSafeInteger(n) && n <= 1000000000 ? n : null;
}
