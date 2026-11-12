import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localToday } from "../src/expense-types";
test("expense ledger, category tabs, billing intervals, CSV, editing, persistence, and destructive confirmations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-expense-ui-"));
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Expenses", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Expenses." }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Total spend", exact: true }),
    ).toContainText("$0.00");
    for (const row of [
      {
        name: "Residential proxies",
        category: "Proxy Providers",
        amount: "90.00",
        months: "3",
      },
      {
        name: "Shipping label",
        category: "Shipping Costs",
        amount: "12.50",
        months: "0",
      },
      {
        name: "Group membership",
        category: "Cook Groups",
        amount: "60.00",
        months: "6",
      },
      {
        name: "Collection storage",
        category: "My Collection",
        amount: "120.00",
        months: "12",
      },
      {
        name: "Monthly app",
        category: "Other Expenses",
        amount: "9.99",
        months: "1",
      },
    ]) {
      await page
        .getByRole("button", { name: "Add expense", exact: true })
        .first()
        .click();
      const form = page.getByRole("dialog");
      await form.getByLabel("Description", { exact: true }).fill(row.name);
      await form
        .getByLabel("Provider", { exact: true })
        .fill(row.name === "Residential proxies" ? "Provider A" : "Provider B");
      await form
        .getByLabel("Category", { exact: true })
        .selectOption(row.category);
      await form.getByLabel("Amount ($)", { exact: true }).fill(row.amount);
      if (row.months !== "0") {
        await form
          .getByRole("switch", { name: "Recurring", exact: true })
          .check();
        await form
          .getByLabel("Repeat every", { exact: true })
          .selectOption(row.months);
      }
      if (row.name === "Residential proxies")
        await page.screenshot({ path: "work/expense-add.png", fullPage: true });
      await form
        .getByRole("button", { name: "Add expense", exact: true })
        .click();
      await expect(form).toHaveCount(0);
    }
    await expect(
      page.getByRole("article", { name: "Total spend", exact: true }),
    ).toContainText("$292.49");
    await expect(
      page.getByRole("article", { name: "Recurring / mo", exact: true }),
    ).toContainText("$59.99");
    await page.getByRole("tab", { name: /Cook Groups/ }).click();
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(1);
    await expect(page.locator(".expense-ledger tbody")).toContainText(
      "Group membership",
    );
    await page.getByRole("tab", { name: /^All/ }).click();
    await page.getByLabel("Search expenses").fill("Provider A");
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(1);
    await expect(page.locator(".expense-ledger tbody")).toContainText(
      "Residential proxies",
    );
    await page.getByLabel("Search expenses").fill("");
    await page.getByRole("tab", { name: /^All/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: /Proxy Providers/ }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: /^All/ }).click();
    await page
      .getByRole("button", { name: "Edit charge Shipping label", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Amount ($)", { exact: true })
      .fill("15.75");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save charge" })
      .click();
    await expect(
      page.getByRole("article", { name: "Total spend", exact: true }),
    ).toContainText("$295.74");
    const csv = join(dir, "expenses.csv");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, csv);
    await page.getByRole("button", { name: "Export CSV" }).click();
    await expect(page.getByRole("status")).toContainText("exported");
    expect(readFileSync(csv, "utf8")).toContain("recurring_months");
    const bad = join(dir, "invalid.csv");
    writeFileSync(
      bad,
      "description,category,amount,date\nInvalid,Other Expenses,12.345," +
        localToday(),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, bad);
    await page.getByRole("button", { name: "Import CSV" }).click();
    await expect(page.getByRole("alert")).toContainText("row 2");
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(5);
    const incoming = join(dir, "incoming.csv");
    writeFileSync(
      incoming,
      "description,provider,retailer,category,amount,date,recurring_months\nMailbox subscription,Example,,Other Expenses,36.00," +
        localToday() +
        ",3",
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, incoming);
    await page.getByRole("button", { name: "Import CSV" }).click();
    await expect(page.getByRole("dialog")).toContainText("1 charge records");
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(5);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Import expenses" })
      .click();
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(6);
    await expect(
      page.getByRole("article", { name: "Total spend", exact: true }),
    ).toContainText("$331.74");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, csv);
    await page.getByRole("button", { name: "Import CSV" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Import expenses" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "0 expense entries imported",
    );
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(6);
    await page.screenshot({ path: "work/expenses.png", fullPage: true });
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Expenses", exact: true }).click();
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(6);
    await expect(
      page.getByRole("article", { name: "Total spend", exact: true }),
    ).toContainText("$331.74");
    const schedule = page
      .locator(".expense-schedules tbody tr")
      .filter({ hasText: "Residential proxies" });
    await schedule.getByRole("button", { name: "Stop repeats" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(
      page.getByRole("article", { name: "Recurring / mo", exact: true }),
    ).toContainText("$71.99");
    await schedule.getByRole("button", { name: "Stop repeats" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Stop repeats" })
      .click();
    await expect(
      page.getByRole("article", { name: "Recurring / mo", exact: true }),
    ).toContainText("$41.99");
    const group = page
      .locator(".expense-schedules tbody tr")
      .filter({ hasText: "Group membership" });
    await group.getByRole("button", { name: "Edit schedule" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Amount ($)", { exact: true })
      .fill("240.00");
    await page
      .getByRole("dialog")
      .getByLabel("Repeat every", { exact: true })
      .selectOption("12");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save schedule" })
      .click();
    await expect(
      page
        .locator(".expense-ledger tbody tr")
        .filter({ hasText: "Group membership" }),
    ).toContainText("$60.00");
    await expect(
      page.getByRole("article", { name: "Recurring / mo", exact: true }),
    ).toContainText("$51.99");
    await page
      .getByRole("button", { name: "Delete charge Monthly app", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("checkbox")).toBeChecked();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete charge", exact: true })
      .click();
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(5);
    await expect(
      page.getByRole("article", { name: "Recurring / mo", exact: true }),
    ).toContainText("$42.00");
    await page.getByRole("button", { name: "Delete all", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(5);
    await page.getByRole("button", { name: "Delete all", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete all expenses", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "Total spend", exact: true }),
    ).toContainText("$0.00");
    await expect(page.locator(".expense-ledger tbody tr")).toHaveCount(0);
    expect(
      await page.evaluate(
        async () => (await window.toolbox!.snapshot()).orders.length,
      ),
    ).toBe(36);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
