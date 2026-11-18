import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createWorkspaceFixture } from "./workspace-fixture";
import { CompanionServer } from "../electron/mobile/server";
test.use({ actionTimeout: 15000 });
const origin = "https://workspace.example.ts.net";
async function open(browser: any) {
  const f = await createWorkspaceFixture(),
    server = new CompanionServer(
      f.db,
      join(process.cwd(), "dist"),
      0,
      (device: string, input: unknown) => f.gateway.execute(device, input),
    );
  expect((await server.start({ url: origin })).ok).toBe(true);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  let dropNextWrite = false;
  await context.route(origin + "/**", async (route: any) => {
    try {
      const req = route.request(),
        url = new URL(req.url()),
        response = await fetch(
          "http://127.0.0.1:" + server.localPort() + url.pathname,
          {
            method: req.method(),
            headers: await req.allHeaders(),
            body: req.postData() || undefined,
          },
        );
      if (
        url.pathname === "/api/workspace" &&
        dropNextWrite &&
        JSON.parse(req.postData() || "{}").method === "addOrder"
      ) {
        dropNextWrite = false;
        await response.arrayBuffer();
        await route.abort();
        return;
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByLabel("Pairing code").fill(server.status().pairCode);
  await page.getByRole("button", { name: "Pair this iPhone" }).click();
  await expect(
    page.getByRole("button", { name: "Quick view", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overview." })).toBeVisible();
  return {
    ...f,
    page,
    context,
    server,
    dropNextSaveResponse() {
      dropNextWrite = true;
    },
    async close() {
      server.stop();
      await context.close();
      f.db.close();
    },
  };
}
test("full iPhone workspace edits orders, collection photos, recurring expenses, shipping tasks and selling drafts", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await open(browser),
    { page } = f;
  try {
    const phoneNav = page.locator(".app-shell > aside");
    expect((await phoneNav.boundingBox())!.height).toBeLessThan(100);
    await page.getByRole("button", { name: "Quick view", exact: true }).click();
    await page
      .getByRole("button", { name: "Full toolbox", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Overview." }),
    ).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    await page.getByRole("button", { name: "Add order", exact: true }).click();
    let form = page.getByRole("dialog");
    await form.getByLabel("Product name").fill("Full phone order");
    await form.getByLabel("Store", { exact: true }).fill("Phone store");
    await form.getByLabel("Total cost (USD)").fill("7.98");
    await form.getByRole("button", { name: "Save order", exact: true }).click();
    await page.getByLabel("Search orders").fill("Full phone order");
    await page.getByLabel("Edit order Full phone order").click();
    form = page.getByRole("dialog");
    await form.getByLabel("Total cost (USD)").fill("12.34");
    await form.getByRole("button", { name: "Save order", exact: true }).click();
    expect(
      f.db.snapshot().orders.find((o) => o.name === "Full phone order")?.total,
    ).toBe(12.34);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    expect((await download).suggestedFilename()).toBe(
      "personal-toolbox-orders.csv",
    );
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: /Comic books/ }).click();
    await page.getByRole("button", { name: "Add comic", exact: true }).click();
    form = page.getByRole("dialog");
    await form
      .getByLabel("Item name", { exact: true })
      .fill("Full phone comic");
    await form.getByLabel("Quantity owned", { exact: true }).fill("2");
    await form
      .getByLabel("Unit purchase price ($)", { exact: true })
      .fill("3.99");
    await form
      .getByLabel("Unit value estimate ($)", { exact: true })
      .fill("8.99");
    const chooser = page.waitForEvent("filechooser");
    await form.getByRole("button", { name: "Add your photo" }).click();
    await (
      await chooser
    ).setFiles({
      name: "phone-photo.png",
      mimeType: "image/png",
      buffer: readFileSync(join(process.cwd(), "dist/icon-192.png")),
    });
    await expect(
      form.getByRole("img", { name: "Selected collection photo" }),
    ).toBeVisible();
    await form.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "Full phone comic", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Edit item Full phone comic").click();
    await page
      .getByRole("dialog")
      .getByLabel("Quantity owned", { exact: true })
      .fill("3");
    await page.getByRole("button", { name: "Save item", exact: true }).click();
    expect(
      f.db.collection.items().find((i) => i.name === "Full phone comic")
        ?.quantity,
    ).toBe(3);
    await page.getByRole("button", { name: "Expenses", exact: true }).click();
    await page
      .getByRole("button", { name: "Add expense", exact: true })
      .first()
      .click();
    form = page.getByRole("dialog");
    await form
      .getByLabel("Description", { exact: true })
      .fill("Full phone renewal");
    await form.getByLabel("Amount ($)", { exact: true }).fill("12.00");
    await form.getByRole("switch", { name: "Recurring", exact: true }).check();
    await form.getByLabel("Repeat every", { exact: true }).selectOption("3");
    await form
      .getByRole("button", { name: "Add expense", exact: true })
      .click();
    await page.getByLabel("Edit charge Full phone renewal").click();
    await page
      .getByRole("dialog")
      .getByLabel("Amount ($)", { exact: true })
      .fill("15.00");
    await page
      .getByRole("button", { name: "Save charge", exact: true })
      .click();
    expect(
      f.db.expenses
        .state("2026-11-18")
        .entries.find((e) => e.description === "Full phone renewal")
        ?.amountCents,
    ).toBe(1500);
    const expenseDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const downloaded = await expenseDownload;
    const path = await downloaded.path();
    const csv = readFileSync(path!);
    const importChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    await (
      await importChooser
    ).setFiles({ name: "expenses.csv", mimeType: "text/csv", buffer: csv });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Import expenses", exact: true })
      .click();
    expect(
      f.db.expenses
        .state(new Date().toISOString().slice(0, 10))
        .entries.filter((e) => e.description === "Full phone renewal"),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await page
      .getByRole("button", { name: "Add shipping task", exact: true })
      .click();
    form = page.getByRole("dialog");
    await form
      .getByLabel("Item / task name", { exact: true })
      .fill("Ship full phone item");
    await form.getByRole("button", { name: "Add task", exact: true }).click();
    await page.getByLabel("Edit shipping task Ship full phone item").click();
    form = page.getByRole("dialog");
    await form
      .getByLabel("Item / task name", { exact: true })
      .fill("Ship edited phone item");
    await form
      .getByRole("button", { name: "Save shipping task", exact: true })
      .click();
    expect(
      f.db.shipping.items().some((t) => t.name === "Ship edited phone item"),
    ).toBe(true);
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: /Comic books/ }).click();
    await page.getByLabel("Sell item Full phone comic").click();
    form = page.getByRole("dialog");
    await form
      .getByLabel("Physical copy label", { exact: true })
      .fill("Phone copy");
    await form
      .getByLabel("Listing title", { exact: true })
      .fill("Full phone listing");
    await form.getByLabel("Selling price (USD)", { exact: true }).fill("29.99");
    await form
      .getByLabel("eBay item condition", { exact: true })
      .selectOption("USED_VERY_GOOD");
    await form
      .getByRole("button", { name: "Save shared draft", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "Phone copy", exact: true }),
    ).toBeVisible();
    expect(
      f.db.selling.units().find((u) => u.unitLabel === "Phone copy")?.title,
    ).toBe("Full phone listing");
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Connected inboxes" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "iPhone workspace" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    await page.screenshot({
      path: "work/mobile-full-workspace.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await f.close();
  }
});
test("phone editor rejects a PC change even after polling, and outstanding multi-select edits are available", async ({
  browser,
}) => {
  const f = await open(browser),
    { page } = f;
  try {
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    const order = f.db.snapshot().orders[0];
    await page.getByLabel("Search orders").fill(order.name);
    await page
      .getByLabel("Edit order " + order.name)
      .first()
      .click();
    await page.getByRole("dialog").getByLabel("Total cost (USD)").fill("42.00");
    const { id, ...item } = order;
    f.db.updateOrder({ id, item: { ...item, total: 99 } });
    await page.evaluate(async () => {
      await window.toolbox!.snapshot();
    });
    await page.getByRole("button", { name: "Save order", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "changed on your PC",
    );
    expect(f.db.snapshot().orders.find((o) => o.id === id)?.total).toBe(99);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    f.db.mail.ingest(
      "fixture",
      [
        {
          transactionId: "BULKPHONE00000001",
          purchaseDate: "2026-11-17",
          lines: ["Phone A", "Phone B"].map((description) => ({
            description,
            quantity: 1,
            unitCents: 399,
            amountCents: 399,
            kind: "item",
          })),
        },
      ],
      { validity: "1", lastUid: 1 },
      { scanned: 1, skipped: 0, limited: false },
    );
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: /Outstanding orders/ }).click();
    await page.getByLabel("Select all matching outstanding lines").check();
    await page
      .getByRole("button", { name: "Set expected date", exact: true })
      .click();
    await page
      .getByLabel("Expected arrival date (optional)")
      .fill("2027-01-20");
    await page
      .getByRole("button", { name: "Save expected date", exact: true })
      .click();
    expect(
      f.db.mail.lines().every((l) => l.expectedDate === "2027-01-20"),
    ).toBe(true);
    await page.getByLabel("Select all matching outstanding lines").check();
    await page
      .getByRole("button", { name: "Delete selected", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete lines", exact: true })
      .click();
    expect(f.db.mail.lines()).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("retrying a phone save after the committed response is lost creates one order", async ({
  browser,
}) => {
  const f = await open(browser),
    { page } = f;
  try {
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    await page.getByRole("button", { name: "Add order", exact: true }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Product name").fill("Interrupted phone save");
    await form.getByLabel("Store", { exact: true }).fill("Phone store");
    await form.getByLabel("Total cost (USD)").fill("8.99");
    f.dropNextSaveResponse();
    await form.getByRole("button", { name: "Save order", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText(
      "connection was interrupted",
    );
    expect(
      f.db.snapshot().orders.filter((o) => o.name === "Interrupted phone save"),
    ).toHaveLength(1);
    await form.getByRole("button", { name: "Save order", exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(
      f.db.snapshot().orders.filter((o) => o.name === "Interrupted phone save"),
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
});
