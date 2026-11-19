import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { Store } = require("../dist-electron/electron/database.js");
test.use({ actionTimeout: 10000 });
const origin = "https://organizer.example.ts.net";
test("organizer workflows persist, calculate true profit, keep backups and support guarded phone changes with history", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const dir = mkdtempSync(join(tmpdir(), "organizer-ui-")),
    db = await Store.open(join(dir, "personal-toolbox.sqlite"));
  const collectionId = db.collection.addManual({
    name: "Absolute test #17",
    category: "Comics",
    collectionType: "comics",
    quantity: 3,
    purchaseCents: 500,
    valueCents: 800,
    referenceUrl: null,
    imageData: null,
  });
  const orderId = db.snapshot().orders[0].id;
  db.close();
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  try {
    let page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.getByRole("button", { name: "Organizer", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Organizer." }),
    ).toBeVisible();
    const tab = async (name: string) =>
      page.getByRole("tab", { name, exact: true }).click();
    const add = async (name: string) => {
      await page.getByRole("button", { name, exact: true }).click();
      return page.getByRole("dialog");
    };
    const save = async () => {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Save record", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await tab("Orders");
    let form = await add("Add order line");
    await form.getByLabel("Order", { exact: true }).selectOption(orderId);
    await form
      .getByLabel("Description", { exact: true })
      .fill("Three test comics");
    await form.getByLabel("Quantity ordered").fill("3");
    await form.getByLabel("Unit purchase price ($)").fill("5.00");
    await save();
    form = await add("Add package");
    await form.getByLabel("Order", { exact: true }).selectOption(orderId);
    await form.getByLabel("Carrier", { exact: true }).selectOption("USPS");
    await form.getByLabel("Tracking number").fill("9400123456789");
    await form.getByLabel("Expected arrival (optional)").fill("2027-01-01");
    await save();
    form = await add("Add receiving record");
    await form
      .getByLabel("Order line", { exact: true })
      .selectOption({ index: 1 });
    await form.getByLabel("Package (optional)").selectOption({ index: 1 });
    await form.getByLabel("Quantity received").fill("2");
    await save();
    await expect(
      page.locator(".organizer-record").filter({ hasText: "Order line" }),
    ).toContainText("2 / 3 received");
    form = await add("Add receiving record");
    await form
      .getByLabel("Order line", { exact: true })
      .selectOption({ index: 1 });
    await form.getByLabel("Quantity received").fill("2");
    await form.getByRole("button", { name: "Save record" }).click();
    await expect(form.getByRole("alert")).toContainText("exceeds");
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await tab("Collection");
    form = await add("Add comic details / location");
    await form
      .getByLabel("Collection item", { exact: true })
      .selectOption(collectionId);
    await form.getByLabel("Series (optional)").fill("Absolute Batman");
    await form.getByLabel("Issue number").fill("17");
    await form.getByLabel("Cover artist").fill("Eric Canete");
    await form.getByLabel("Cover / variant").fill("Cover D");
    await form.getByLabel("Storage location").fill("Office / Box 3");
    await save();
    await expect(page.locator(".organizer-record")).toContainText(
      "Office / Box 3",
    );
    form = await add("Add photo / receipt");
    await form.getByLabel("Item / order").selectOption(collectionId);
    await form.getByLabel("Photo or PDF receipt").setInputFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: readFileSync(join(process.cwd(), "dist/icon-192.png")),
    });
    await expect(form.getByText("Attachment ready")).toBeVisible();
    await save();
    await expect(page.getByRole("img", { name: "cover.png" })).toBeVisible();
    await tab("Finances");
    form = await add("Add sale / item profit");
    await form
      .getByLabel("Collection item", { exact: true })
      .selectOption(collectionId);
    await form.getByLabel("Quantity sold").fill("2");
    await form.getByLabel("Marketplace", { exact: true }).fill("eBay");
    await form.getByLabel("Gross sale including shipping/tax ($)").fill("30");
    await form.getByLabel("Allocated purchase shipping ($)").fill("1");
    await form.getByLabel("Allocated purchase tax ($)").fill("0.50");
    await form.getByLabel("Marketplace fees ($)").fill("3");
    await form.getByLabel("Outgoing postage ($)").fill("2");
    await form.getByLabel("Tax withheld / remitted ($)").fill("1");
    await form
      .getByLabel("Actual payout received ($) (optional)")
      .fill("23.50");
    await save();
    await expect(page.locator(".organizer-record")).toContainText(
      "profit $12.50",
    );
    await expect(page.locator(".organizer-record")).toContainText(
      "difference -$0.50",
    );
    await tab("Budgets");
    form = await add("Add monthly budget");
    await form.getByLabel("Monthly budget ($)").fill("100");
    await save();
    await expect(
      page.getByRole("heading", { name: "This month’s expense ledger" }),
    ).toBeVisible();
    await tab("Reminders");
    form = await add("Add reminder");
    await form
      .getByLabel("Reminder", { exact: true })
      .fill("Return test comics");
    await form.getByLabel("Due date").fill("2020-01-01");
    await save();
    await tab("Overview");
    await expect(
      page.getByText("Return test comics", { exact: true }).first(),
    ).toBeVisible();
    await tab("Backups");
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Create backup", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toHaveCount(2);
    await tab("Collection");
    await page.getByLabel("Delete cover.png", { exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await tab("Backups");
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toHaveCount(3);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Private Tailscale HTTPS address").fill(origin);
    await page.getByRole("button", { name: "Enable iPhone companion" }).click();
    const code = page.getByLabel("Current pairing code");
    await expect(code).toHaveText(/^\d{8}$/);
    const pairCode = await code.textContent();
    await context.route(origin + "/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const r = await fetch("http://127.0.0.1:17863" + url.pathname, {
        method: req.method(),
        headers: await req.allHeaders(),
        body: req.postData() || undefined,
      });
      await route.fulfill({
        status: r.status,
        headers: Object.fromEntries(r.headers.entries()),
        body: Buffer.from(await r.arrayBuffer()),
      });
    });
    const phone = await context.newPage();
    await phone.goto(origin);
    await phone.getByLabel("Device name").fill("Organizer test phone");
    await phone.getByLabel("Pairing code").fill(pairCode!);
    await phone.getByRole("button", { name: "Pair this iPhone" }).click();
    await expect(
      phone.getByRole("heading", { name: "Overview." }),
    ).toBeVisible();
    await phone.getByRole("button", { name: "Organizer", exact: true }).click();
    await phone.getByRole("tab", { name: "Wishlist", exact: true }).click();
    await page.getByRole("button", { name: "Organizer", exact: true }).click();
    await tab("Wishlist");
    await phone
      .getByRole("button", { name: "Add wishlist item", exact: true })
      .click();
    let phoneForm = phone.getByRole("dialog");
    await phoneForm.getByLabel("Wanted item").fill("Phone wish");
    await phoneForm.getByRole("button", { name: "Save record" }).click();
    await expect(phone.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".organizer-record")).toContainText("Phone wish");
    await phone.getByRole("tab", { name: "History", exact: true }).click();
    await expect(phone.locator(".organizer-record").first()).toContainText(
      "iPhone: Organizer test phone",
    );
    await phone
      .locator(".organizer-record")
      .first()
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    await phone
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(phone.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".organizer-record")).toHaveCount(0);
    await phone.getByRole("tab", { name: "Backups", exact: true }).click();
    await expect(
      phone.getByRole("button", { name: "Restore", exact: true }),
    ).toHaveCount(0);
    await expect(
      phone.getByRole("button", { name: "Create backup", exact: true }),
    ).toBeVisible();
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Organizer", exact: true }).click();
    await tab("Collection");
    await expect(
      page.locator(".organizer-record").filter({ hasText: "Office / Box 3" }),
    ).toHaveCount(1);
  } finally {
    await context.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
