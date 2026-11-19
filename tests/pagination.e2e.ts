import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { Store } = require("../dist-electron/electron/database.js");
test.use({ actionTimeout: 10000 });
test("25/50 pagination searches beyond old limits, opens manual references and drills into exact collection categories", async () => {
  test.setTimeout(120000);
  const dir = mkdtempSync(join(tmpdir(), "pagination-ui-"));
  const db = await Store.open(join(dir, "personal-toolbox.sqlite"));
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 231; i++)
    db.addOrder({
      name:
        i === 230
          ? "Needle order beyond 200"
          : `Paged order ${String(i).padStart(3, "0")}`,
      store: "Page store",
      category: "Other",
      total: 1,
      status: "Processing",
      date: today,
    });
  for (let i = 0; i < 61; i++)
    db.collection.addManual({
      name:
        i === 60
          ? "Paged inventory needle"
          : `Paged inventory ${String(i).padStart(3, "0")}`,
      category: i % 2 ? "Page comics" : "Page cards",
      collectionType: i % 2 ? "comics" : "cards",
      quantity: 1,
      purchaseCents: 100,
      valueCents: 200,
      referenceUrl: i === 60 ? "https://example.org/collectible/needle" : null,
      imageData: null,
    });
  db.close();
  const app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: /^Orders/ }).click();
    await page.getByLabel("Search orders").fill("Paged order");
    await expect(page.getByLabel("order rows per page")).toHaveValue("25");
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await page.getByLabel("Next order page").click();
    await expect(page.locator("tbody")).toContainText("Paged order 025");
    await page.getByLabel("order rows per page").selectOption("50");
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await expect(page.locator("tbody")).toContainText("Paged order 000");
    await page.getByLabel("Next order page").click();
    await page.getByLabel("Search orders").fill("Needle order beyond 200");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText(
      "Needle order beyond 200",
    );
    await page.getByLabel("Search orders").fill("Paged order");
    await expect(page.locator("tbody")).toContainText("Paged order 000");
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByLabel("Search owned collection").fill("Paged inventory");
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await page.getByLabel("collection rows per page").selectOption("50");
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await page.getByLabel("Next collection page").click();
    await expect(page.locator("tbody tr")).toHaveCount(11);
    await page
      .getByLabel("Search owned collection")
      .fill("Paged inventory needle");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url: string) => {
        (globalThis as any).__openedReference = url;
      };
    });
    await page.getByLabel("Open reference for Paged inventory needle").click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__openedReference))
      .toBe("https://example.org/collectible/needle");
    await page.getByRole("button", { name: "Analytics", exact: true }).click();
    await page
      .getByRole("button", { name: "View Page cards collection", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Category: Page cards",
    );
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await page.getByLabel("collection rows per page").selectOption("50");
    await expect(page.locator("tbody tr")).toHaveCount(31);
    await expect(page.locator("tbody")).not.toContainText("Page comics");
    await page
      .getByRole("button", { name: "Clear category filter", exact: true })
      .click();
    await expect(page.locator("tbody")).toContainText("Page comics");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
