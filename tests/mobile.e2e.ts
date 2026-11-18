import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { Store } = require("../dist-electron/electron/database.js");
const {
  CompanionServer,
} = require("../dist-electron/electron/mobile/server.js");
const origin = "https://companion.example.ts.net";
test("iPhone-sized companion pairs securely and updates the same desktop database", async ({
  browser,
}) => {
  const db = await Store.open();
  db.mail.ingest(
    "fixture",
    [
      {
        transactionId: "POCKETTEST000001",
        purchaseDate: "2026-11-16",
        lines: [
          {
            description: "Pocket comic",
            unitCents: 399,
            quantity: 2,
            amountCents: 798,
            kind: "item",
          },
        ],
      },
    ],
    { validity: "1", lastUid: 1 },
    { scanned: 1, skipped: 0, limited: false },
  );
  const taskId = db.shipping.add({
    name: "Ship Pocket comic",
    orderReference: null,
    shipBy: "2026-12-01",
    status: "Needs Shipment",
    paymentStatus: "Paid",
    notes: "",
  });
  db.expenses.create(
    {
      description: "Pocket postage",
      category: "Shipping Costs",
      provider: "Carrier",
      retailer: "",
      amountCents: 599,
      date: "2026-11-17",
      intervalMonths: 0,
    },
    "2026-11-17",
  );
  const server = new CompanionServer(db, join(process.cwd(), "dist"), 0);
  expect((await server.start({ url: origin })).ok).toBe(true);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  let networkLost = false;
  // Intercept the private HTTPS origin so integration uses real local server/DB without Tailscale or external traffic.
  await context.route(origin + "/**", async (route) => {
    if (networkLost) {
      await route.abort();
      return;
    }
    const req = route.request(),
      url = new URL(req.url()),
      headers = await req.allHeaders();
    const response = await fetch(
      "http://127.0.0.1:" + server.localPort() + url.pathname,
      { method: req.method(), headers, body: req.postData() || undefined },
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await expect(
      page.getByRole("button", { name: "Pair this iPhone" }),
    ).toBeVisible();
    await page.getByLabel("Pairing code").fill(server.status().pairCode);
    await page.getByRole("button", { name: "Pair this iPhone" }).click();
    await expect(page.getByRole("heading", { name: "Home." })).toBeVisible();
    expect(
      (await context.cookies(origin)).find((c) => c.name === "__Host-toolbox"),
    ).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    await page
      .getByRole("button", { name: "Outstanding", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Pocket comic" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit expected date" }).click();
    await page
      .getByLabel("Expected arrival date (optional)")
      .fill("2027-01-10");
    await page.getByLabel("I reviewed this item").check();
    await page.getByRole("button", { name: "Confirm and save" }).click();
    await expect(page.getByText("2027-01-10", { exact: true })).toBeVisible();
    expect(db.mail.lines()[0].expectedDate).toBe("2027-01-10");
    await page
      .getByRole("button", { name: "Receive items", exact: true })
      .click();
    await page.getByLabel("Quantity received").fill("1");
    await page.getByLabel("I reviewed this item").check();
    await page.getByRole("button", { name: "Confirm and save" }).click();
    await expect(page.getByText("1 remaining", { exact: true })).toBeVisible();
    expect(db.mail.lines()[0].receivedQty).toBe(1);
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await page.getByRole("button", { name: "Update task status" }).click();
    await page
      .getByLabel("Task status", { exact: true })
      .selectOption("Shipped");
    await page.getByLabel("I reviewed this item").check();
    await page.getByRole("button", { name: "Confirm and save" }).click();
    await expect(page.getByText("SHIPPED", { exact: true })).toBeVisible();
    expect(db.shipping.items().find((t: any) => t.id === taskId).status).toBe(
      "Shipped",
    );
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByLabel("Search collection").fill("Pocket comic");
    await expect(
      page.getByRole("heading", { name: "Pocket comic" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Expenses", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Pocket postage" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.screenshot({
      path: "work/mobile-companion.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    networkLost = true;
    await page.getByRole("button", { name: "Refresh data" }).click();
    await expect(
      page.getByText("Connection lost", { exact: true }),
    ).toBeVisible();
    networkLost = false;
    server.revoke(server.status().devices[0].id);
    await page.getByRole("button", { name: "Refresh data" }).click();
    await expect(
      page.getByRole("button", { name: "Pair this iPhone" }),
    ).toBeVisible();
  } finally {
    await context.close();
    server.stop();
    db.close();
  }
});
test("desktop settings remember the address after pause and automatically resume after app restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "companion-settings-"));
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "iPhone companion" }),
    ).toBeVisible();
    await page.getByLabel("Private Tailscale HTTPS address").fill(origin);
    await page.getByRole("button", { name: "Enable iPhone companion" }).click();
    await expect(page.getByLabel("Current pairing code")).toHaveText(/^\d{8}$/);
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    await page.getByRole("button", { name: "New pairing code" }).click();
    await expect(page.getByLabel("Current pairing code")).toHaveText(/^\d{8}$/);
    await page
      .getByRole("button", { name: "Pause companion", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Enable iPhone companion" }),
    ).toBeVisible();
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    let restarted = await app.firstWindow();
    await restarted
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(
      restarted.getByLabel("Private Tailscale HTTPS address"),
    ).toHaveValue(origin);
    await expect(
      restarted.getByRole("button", { name: "Enable iPhone companion" }),
    ).toBeVisible();
    await restarted
      .getByRole("button", { name: "Enable iPhone companion" })
      .click();
    await expect(restarted.getByLabel("Current pairing code")).toHaveText(
      /^\d{8}$/,
    );
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    restarted = await app.firstWindow();
    await restarted
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(restarted.getByLabel("Current pairing code")).toHaveText(
      /^\d{8}$/,
    );
    await expect(
      restarted.getByLabel("Private Tailscale HTTPS address"),
    ).toHaveValue(origin);
    await restarted
      .getByRole("button", { name: "Pause companion", exact: true })
      .click();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
