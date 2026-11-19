import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { Store } = require("../dist-electron/electron/database.js");
const origin = "https://inbox-delete.example.ts.net";
test.use({ actionTimeout: 10000 });
test("desktop and paired phone can cancel/confirm deleting untracked email updates, with live refresh and restart persistence", async ({
  browser,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-delete-ui-"));
  const db = await Store.open(join(dir, "personal-toolbox.sqlite"));
  const scan = {
    events: [],
    scanned: 2,
    skipped: 0,
    limited: false,
    updates: ["Desktop removable update", "Phone removable update"].map(
      (subject, i) => ({
        externalId: `delete-ui-${i}`,
        subject,
        received: new Date().toISOString(),
        status: "Order confirmed",
        orderReference: null,
      }),
    ),
  };
  db.recordInboxScan(scan);
  db.close();
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  try {
    let desktop = await app.firstWindow();
    await desktop.getByRole("button", { name: "Inbox", exact: true }).click();
    const row = (page: any, text: string) =>
      page.locator(".shipment-row").filter({ hasText: text });
    await desktop
      .getByLabel("Delete email update Desktop removable update")
      .click();
    await expect(desktop.getByRole("dialog")).toHaveCSS(
      "color",
      "rgb(220, 225, 233)",
    );
    await desktop
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(row(desktop, "Desktop removable update")).toHaveCount(1);
    await desktop
      .getByLabel("Delete email update Desktop removable update")
      .click();
    await desktop
      .getByRole("dialog")
      .getByRole("button", { name: "Delete update", exact: true })
      .click();
    await expect(row(desktop, "Desktop removable update")).toHaveCount(0);
    await desktop
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await desktop.getByLabel("Private Tailscale HTTPS address").fill(origin);
    await desktop
      .getByRole("button", { name: "Enable iPhone companion" })
      .click();
    const code = desktop.getByLabel("Current pairing code");
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
    await phone.getByLabel("Pairing code").fill(pairCode!);
    await phone.getByRole("button", { name: "Pair this iPhone" }).click();
    await expect(
      phone.getByRole("heading", { name: "Overview." }),
    ).toBeVisible();
    await desktop.getByRole("button", { name: "Inbox", exact: true }).click();
    await phone.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(row(phone, "Phone removable update")).toHaveCount(1);
    await phone
      .getByLabel("Delete email update Phone removable update")
      .click();
    await phone
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(row(phone, "Phone removable update")).toHaveCount(1);
    await phone
      .getByLabel("Delete email update Phone removable update")
      .click();
    await phone
      .getByRole("dialog")
      .getByRole("button", { name: "Delete update", exact: true })
      .click();
    await expect(row(phone, "Phone removable update")).toHaveCount(0);
    await expect(row(desktop, "Phone removable update")).toHaveCount(0);
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    desktop = await app.firstWindow();
    await desktop.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(desktop.locator(".shipment-row")).toHaveCount(0);
  } finally {
    await context.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
