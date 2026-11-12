import { test, expect, _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// Seed parsed email fixtures before launch; UI edits use the real production
// preload, authorized IPC, repository and SQLite file. No credential bypass.
const { Store } = require("../dist-electron/electron/database.js");
const {
  extractEbaySale,
} = require("../dist-electron/electron/shipping/extract.js");
const { localToday } = require("../dist-electron/electron/shipping/model.js");
test("Needs Shipment: parsed sale deadlines, editing, completion, cancellation, deletion suppression and restart persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-shipping-ui-")),
    path = join(dir, "personal-toolbox.sqlite");
  const email = "seller@example.invalid";
  const event = extractEbaySale({
    subject: "You made the sale for Example Championship Card",
    senders: ["ebay@ebay.com"],
    received: "2026-10-01T12:00:00.000Z",
    externalId: createHash("sha256").update("sale-1").digest("hex"),
    text: "Great news—your item has sold!\nYour buyer has paid.\nShip by:\nOct 02, 2026\nOrder number: 12-34567-89012",
  });
  let db = await Store.open(path);
  db.shipping.ingest(email, {
    sales: [
      event,
      {
        ...event,
        name: "Sale missing a deadline",
        externalId: createHash("sha256").update("sale-2").digest("hex"),
        orderReference: "22-34567-89012",
        shipBy: null,
        paymentStatus: "Needs review",
      },
    ],
    scanned: 2,
    skipped: 0,
    limited: false,
    cursor: { uidValidity: "100", lastUid: 10 },
  });
  db.close();
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tasks." })).toBeVisible();
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(2);
    await expect(page.locator(".shipping-list tbody")).toContainText(
      "Oct 2, 2026",
    );
    await expect(page.locator(".shipping-list tbody")).toContainText(
      "Date missing — review eBay",
    );
    await expect(page.locator(".shipping-list tbody")).toContainText(
      "Confirm payment before shipping",
    );
    await expect(
      page.getByRole("button", { name: "Check sales now", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Add shipping task", exact: true })
      .click();
    let form = page.getByRole("dialog");
    await form
      .getByLabel("Item / task name", { exact: true })
      .fill("Pack comic book sale");
    await form.getByLabel("Ship-by date", { exact: true }).fill(localToday());
    await form
      .getByLabel("Payment status", { exact: true })
      .selectOption("Paid");
    await form.getByRole("button", { name: "Add task", exact: true }).click();
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(3);
    await expect(
      page.getByRole("article", { name: "Due today", exact: true }),
    ).toContainText("1");
    await page
      .getByRole("button", {
        name: "Edit shipping task Example Championship Card",
        exact: true,
      })
      .click();
    form = page.getByRole("dialog");
    await form
      .getByLabel("Item / task name", { exact: true })
      .fill("Corrected championship sale");
    await form.getByLabel("Ship-by date", { exact: true }).fill("2099-01-02");
    await form.getByLabel("Notes", { exact: true }).fill("Use rigid mailer");
    await form
      .getByRole("button", { name: "Save shipping task", exact: true })
      .click();
    await expect(page.locator(".shipping-list tbody")).toContainText(
      "Use rigid mailer",
    );
    await page
      .getByRole("button", {
        name: "Mark shipped Corrected championship sale",
        exact: true,
      })
      .click();
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(2);
    await page.getByRole("tab", { name: /^Shipped/ }).click();
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(1);
    await page
      .getByRole("button", {
        name: "Edit shipping task Corrected championship sale",
        exact: true,
      })
      .click();
    form = page.getByRole("dialog");
    await form
      .getByLabel("Task status", { exact: true })
      .selectOption("Cancelled");
    await form
      .getByRole("button", { name: "Save shipping task", exact: true })
      .click();
    await page.getByRole("tab", { name: /^Cancelled/ }).click();
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(1);
    await page
      .getByRole("button", {
        name: "Reopen task Corrected championship sale",
        exact: true,
      })
      .click();
    await page.getByRole("tab", { name: /^Needs Shipment/ }).click();
    await page
      .getByRole("button", {
        name: "Delete shipping task Corrected championship sale",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(3);
    await page
      .getByRole("button", {
        name: "Delete shipping task Corrected championship sale",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete task", exact: true })
      .click();
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(2);
    await page
      .getByLabel("Sales check interval", { exact: true })
      .selectOption("6");
    await page
      .getByLabel("Automatically check eBay sales", { exact: true })
      .uncheck();
    await expect(
      page.getByLabel("Automatically check eBay sales", { exact: true }),
    ).not.toBeChecked();
    await page
      .getByLabel("Search shipping tasks", { exact: true })
      .fill("comic");
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(1);
    await page.getByLabel("Search shipping tasks", { exact: true }).fill("");
    await page.screenshot({ path: "work/needs-shipment.png", fullPage: true });
    await app.close();
    db = await Store.open(path);
    expect(
      db.shipping.ingest(email, {
        sales: [
          {
            ...event,
            externalId: createHash("sha256")
              .update("sale-repeat")
              .digest("hex"),
          },
        ],
        scanned: 1,
        skipped: 0,
        limited: false,
        cursor: { uidValidity: "200", lastUid: 11 },
      }),
    ).toBe(0);
    db.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.locator(".shipping-list tbody tr")).toHaveCount(2);
    await expect(page.locator(".shipping-list tbody")).not.toContainText(
      "Corrected championship sale",
    );
    await expect(page.locator(".shipping-list tbody")).toContainText(
      "Pack comic book sale",
    );
    await expect(
      page.getByLabel("Sales check interval", { exact: true }),
    ).toHaveValue("6");
    await expect(
      page.getByLabel("Automatically check eBay sales", { exact: true }),
    ).not.toBeChecked();
    await page.getByRole("tab", { name: /^Automation/ }).click();
    await expect(
      page.getByText("Collection price watch", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /^Needs Shipment/ }).click();
    await page
      .getByRole("button", { name: "Connect Gmail in Inbox", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Gmail shipment inbox", exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
