import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { Store } = require("../dist-electron/electron/database.js");
test("Ship24 securely connects, confirms registration and shares cached carrier results with iPhone", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const dir = mkdtempSync(join(tmpdir(), "ship24-ui-")),
    db = await Store.open(join(dir, "personal-toolbox.sqlite"));
  db.organizer.save({
    id: null,
    revision: null,
    kind: "package",
    data: {
      orderId: db.snapshot().orders[0].id,
      carrier: "USPS",
      tracking: "9400123456789000",
      status: "In transit",
      expectedDate: "2027-01-01",
      actualDate: null,
      notes: "Preserve manual data",
    },
  });
  db.close();
  const app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate((_, root) => {
      const req = process
        .getBuiltinModule("module")
        .createRequire(root + "/package.json");
      const { Ship24Service } = req(
        root + "/dist-electron/electron/ship24/service.js",
      );
      const { Ship24Provider } = req(
        root + "/dist-electron/electron/ship24/provider.js",
      );
      const { WindowsCredentialVault } = req(
        root + "/dist-electron/electron/inbox/credentials.js",
      );
      Ship24Service.prototype.platformSupported = () => true;
      let secret: unknown = null;
      WindowsCredentialVault.prototype.write = async function (v: unknown) {
        secret = v;
      };
      WindowsCredentialVault.prototype.read = async function () {
        return secret;
      };
      WindowsCredentialVault.prototype.remove = async function () {
        secret = null;
      };
      let creates = 0;
      let tracker: any = null;
      (globalThis as any).__ship24Creates = () => creates;
      Ship24Provider.prototype.verify = async () => {};
      Ship24Provider.prototype.find = async () => tracker;
      Ship24Provider.prototype.create = async (_: unknown, payload: any) => {
        creates++;
        tracker = {
          ...payload,
          trackerId: "offline-fixture",
          isSubscribed: true,
        };
        return tracker;
      };
      Ship24Provider.prototype.results = async () => ({
        data: {
          trackings: [
            {
              tracker,
              shipment: {
                statusMilestone: "delivered",
                delivery: { estimatedDeliveryDate: "2027-01-04" },
              },
              statistics: {
                timestamps: { deliveredDatetime: "2027-01-03T12:30:00" },
              },
              events: [
                {
                  occurrenceDatetime: "2027-01-03T12:30:00",
                  status: "Delivered to front door",
                  location: "San Antonio",
                  statusMilestone: "delivered",
                },
              ],
            },
          ],
        },
      });
    }, process.cwd());
    await page.getByRole("button", { name: "Organizer", exact: true }).click();
    await page.getByRole("tab", { name: "Tracking", exact: true }).click();
    const panel = page.locator(".ship24-panel");
    await expect(panel.getByLabel("Ship24 API key")).toBeEnabled();
    await panel.getByLabel("Ship24 API key").fill("offline-browser-secret-key");
    await panel
      .getByRole("button", { name: "Connect Ship24 securely" })
      .click();
    await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
    await expect(panel.getByLabel("Ship24 API key")).toHaveCount(0);
    expect(
      await app.evaluate(() => (globalThis as any).__ship24Creates()),
    ).toBe(0);
    await panel
      .getByRole("button", { name: "Track 9400123456789000 with Ship24" })
      .click();
    const form = page.getByRole("dialog", { name: "Register Ship24 tracking" });
    await form
      .getByRole("button", { name: "Register tracker", exact: true })
      .click();
    expect(
      await app.evaluate(() => (globalThis as any).__ship24Creates()),
    ).toBe(0);
    await form.getByLabel("Confirm Ship24 registration").check();
    await form
      .getByRole("button", { name: "Register tracker", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    expect(
      await app.evaluate(() => (globalThis as any).__ship24Creates()),
    ).toBe(1);
    await panel
      .getByRole("button", { name: "Refresh Ship24 9400123456789000" })
      .click();
    await expect(panel.getByText("Delivered: 2027-01-03")).toBeVisible();
    await panel.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Ship24 timeline" }),
    ).toContainText("Delivered to front door");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    expect(
      await page.evaluate(async () =>
        JSON.stringify(await window.toolbox!.ship24State()),
      ),
    ).not.toContain("offline-browser-secret-key");
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    await expect(
      page.locator(".organizer-record").filter({ hasText: "9400123456789000" }),
    ).toContainText("Delivered (Ship24)");
    const origin = "https://ship24.example.ts.net";
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Private Tailscale HTTPS address").fill(origin);
    await page.getByRole("button", { name: "Enable iPhone companion" }).click();
    const code = page.getByLabel("Current pairing code");
    await expect(code).toHaveText(/^\d{8}$/);
    const pairCode = await code.textContent();
    await context.route(origin + "/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const res = await fetch("http://127.0.0.1:17863" + url.pathname, {
        method: req.method(),
        headers: await req.allHeaders(),
        body: req.postData() || undefined,
      });
      await route.fulfill({
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: Buffer.from(await res.arrayBuffer()),
      });
    });
    const phone = await context.newPage();
    await phone.goto(origin);
    await phone.getByLabel("Device name").fill("Ship24 test phone");
    await phone.getByLabel("Pairing code").fill(pairCode!);
    await phone.getByRole("button", { name: "Pair this iPhone" }).click();
    await expect(
      phone.getByRole("heading", { name: "Overview." }),
    ).toBeVisible();
    await phone.getByRole("button", { name: "Organizer", exact: true }).click();
    await phone.getByRole("tab", { name: "Tracking", exact: true }).click();
    const phonePanel = phone.locator(".ship24-panel");
    await expect(phonePanel.getByText("Delivered: 2027-01-03")).toBeVisible();
    expect(
      await phone.evaluate(() => typeof window.toolbox!.recoverShip24),
    ).toBe("function");
    await phonePanel
      .getByRole("button", { name: "Timeline", exact: true })
      .click();
    await expect(
      phone.getByRole("dialog", { name: "Ship24 timeline" }),
    ).toContainText("San Antonio");
    await phone
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await phonePanel.getByLabel("Automatically refresh Ship24").click();
    await expect
      .poll(async () =>
        page.evaluate(
          async () => (await window.toolbox!.ship24State()).autoEnabled,
        ),
      )
      .toBe(true);
    expect(
      await app.evaluate(() => (globalThis as any).__ship24Creates()),
    ).toBe(1);
  } finally {
    await context.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
