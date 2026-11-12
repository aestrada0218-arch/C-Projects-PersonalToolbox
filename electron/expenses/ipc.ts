import { dialog, type BrowserWindow } from "electron";
import { readFile, writeFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ExpenseRepository } from "./store";
import {
  parseExpenseCsv,
  exportExpenseCsv,
  type ParsedExpenseCsv,
} from "./csv";
import { localToday, type ExpenseResult } from "../../src/expense-types";
export function registerExpenseHandlers(
  repo: ExpenseRepository,
  window: () => BrowserWindow,
  handle: (channel: string, fn: (...args: any[]) => unknown) => void,
) {
  const result = (
    fn: () => ReturnType<ExpenseRepository["state"]>,
  ): ExpenseResult => {
    try {
      return { ok: true, state: fn() };
    } catch {
      return {
        ok: false,
        error:
          "Could not save expenses. Check the fields, billing dates, and storage permissions. Recurring schedules are edited separately from logged charges.",
        state: repo.state(localToday()),
      };
    }
  };
  handle("toolbox:expense-state", () => repo.state(localToday()));
  handle("toolbox:add-expense", (input) =>
    result(() => repo.create(input, localToday())),
  );
  handle("toolbox:edit-expense", (input) =>
    result(() => repo.update(input, localToday())),
  );
  handle("toolbox:edit-expense-schedule", (input) =>
    result(() => repo.updateSchedule(input, localToday())),
  );
  handle("toolbox:stop-expense-schedule", (id) =>
    result(() => repo.stopSchedule(id, localToday())),
  );
  handle("toolbox:delete-expense", (input) =>
    result(() => repo.remove(input, localToday())),
  );
  handle("toolbox:clear-expenses", () =>
    result(() => repo.clear(localToday())),
  );
  let pending: {
    token: string;
    parsed: ParsedExpenseCsv;
    expires: number;
  } | null = null;
  handle("toolbox:preview-expense-import", async () => {
    pending = null;
    const file = await dialog.showOpenDialog(window(), {
      title: "Import expense CSV",
      properties: ["openFile"],
      filters: [{ name: "CSV files", extensions: ["csv"] }],
    });
    if (file.canceled || !file.filePaths[0]) return { cancelled: true };
    try {
      if ((await stat(file.filePaths[0])).size > 8 * 1024 * 1024)
        return { error: "CSV is limited to 8 MiB." };
      const parsed = parseExpenseCsv(await readFile(file.filePaths[0], "utf8"));
      const token = randomUUID();
      pending = { parsed, token, expires: Date.now() + 10 * 60 * 1000 };
      return {
        token,
        charges: parsed.entries.length,
        schedules: parsed.schedules.length,
        newRecurring: parsed.entries.filter(
          (e) => !e.archived && !e.scheduleId && e.intervalMonths > 0,
        ).length,
      };
    } catch (error) {
      return {
        error:
          error instanceof Error &&
          /^(CSV|Missing CSV|Malformed CSV|Unexpected characters|Unclosed CSV)/.test(
            error.message,
          )
            ? error.message
            : "Could not read this CSV file. Check its format and file permissions.",
      };
    }
  });
  handle("toolbox:commit-expense-import", (token) => {
    const valid = z.string().uuid().safeParse(token);
    if (
      !valid.success ||
      !pending ||
      pending.token !== valid.data ||
      pending.expires < Date.now()
    )
      return {
        ok: false,
        error: "This import preview expired. Choose the CSV file again.",
        state: repo.state(localToday()),
      };
    const parsed = pending.parsed;
    pending = null;
    try {
      const r = repo.import(parsed, localToday());
      return { ok: true, ...r };
    } catch {
      return {
        ok: false,
        error:
          "Import was not saved. Check schedule references, duplicate IDs, and local storage permissions.",
        state: repo.state(localToday()),
      };
    }
  });
  handle("toolbox:export-expenses", async () => {
    const file = await dialog.showSaveDialog(window(), {
      title: "Export all expenses and recurring schedules",
      defaultPath: "personal-toolbox-expenses.csv",
      filters: [{ name: "CSV files", extensions: ["csv"] }],
    });
    if (file.canceled || !file.filePath) return { ok: false, cancelled: true };
    try {
      await writeFile(
        file.filePath,
        exportExpenseCsv(repo.state(localToday())),
      );
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: "Could not export expenses. Try another save location.",
      };
    }
  });
  repo.state(localToday());
  const timer = setInterval(() => {
    try {
      repo.state(localToday());
    } catch {
      /* No personal data or raw errors in logs. */
    }
  }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
