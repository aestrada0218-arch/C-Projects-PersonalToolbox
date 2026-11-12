import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("desktop dashboard, secure renderer, persistence, filters, navigation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-ui-"));
  let app = await electron.launch({
    args: [
      ".",
      ...(process.env.DEV_SMOKE ? ["--dev"] : []),
      `--user-data-dir=${dir}`,
    ],
  });
  try {
    let page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Overview." }),
    ).toBeVisible();
    await expect(page.getByText("Local database connected")).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    await page.getByRole("button", { name: "Add order", exact: true }).click();
    await page.getByLabel("Product name").fill("Desktop persistence test");
    await page.getByLabel("Store", { exact: true }).fill("Test shop");
    await page.getByLabel("Total cost (USD)").fill("42.50");
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Order saved" }),
    ).toContainText("Order saved");
    await page.getByRole("button", { name: /^Orders/ }).click();
    await page.getByLabel("Search orders").fill("Desktop persistence test");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("$42.50");
    const exportPath = join(dir, "orders.csv");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, exportPath);
    await page.getByRole("button", { name: "Export CSV" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Orders exported" }),
    ).toBeVisible();
    expect(readFileSync(exportPath, "utf8")).toContain(
      "Desktop persistence test",
    );
    await page.getByLabel("Order status").selectOption("Delivered");
    await expect(page.getByText("No orders match your filters.")).toBeVisible();
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Collection inventory" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: /Needs Shipment/ }),
    ).toBeVisible();
    await expect(page.getByText("Your shipping queue is clear")).toBeVisible();
    await page.getByRole("button", { name: "Analytics", exact: true }).click();
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(page.locator(".recharts-area-curve")).toHaveAttribute(
      "d",
      /M/,
    );
    await page.screenshot({ path: "work/dashboard.png", fullPage: true });
    await app.close();
    app = await electron.launch({
      args: [
        ".",
        ...(process.env.DEV_SMOKE ? ["--dev"] : []),
        `--user-data-dir=${dir}`,
      ],
    });
    page = await app.firstWindow();
    await page.getByRole("button", { name: /^Orders/ }).click();
    await page.getByLabel("Search orders").fill("Desktop persistence test");
    await expect(page.locator("tbody tr")).toHaveCount(1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
