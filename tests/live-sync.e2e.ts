import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test.use({ actionTimeout: 10000 });
const origin = "https://live-sync.example.ts.net";
test("phone writes refresh the open desktop immediately and preserve an unfinished desktop form", async ({
  browser,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "live-sync-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  try {
    const desktop = await app.firstWindow();
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
    await desktop.getByRole("button", { name: /^Orders/ }).click();
    await desktop.getByLabel("Search orders").fill("Phone live order");
    await phone.getByRole("button", { name: "Orders", exact: true }).click();
    await phone.getByRole("button", { name: "Add order", exact: true }).click();
    let form = phone.getByRole("dialog");
    await form.getByLabel("Product name").fill("Phone live order");
    await form.getByLabel("Store", { exact: true }).fill("Live shop");
    await form.getByLabel("Total cost (USD)").fill("7.98");
    await form.getByRole("button", { name: "Save order", exact: true }).click();
    // No click, navigation, focus or reload on the desktop between save and assertion.
    await expect(desktop.locator("tbody")).toContainText("Phone live order", {
      timeout: 5000,
    });
    await phone.getByLabel("Search orders").fill("Phone live order");
    await phone.getByLabel("Edit order Phone live order").click();
    await phone
      .getByRole("dialog")
      .getByLabel("Total cost (USD)")
      .fill("12.34");
    await phone
      .getByRole("button", { name: "Save order", exact: true })
      .click();
    await expect(desktop.locator("tbody")).toContainText("$12.34", {
      timeout: 5000,
    });
    await phone.getByLabel("Delete order Phone live order").click();
    await phone
      .getByRole("dialog")
      .getByRole("button", { name: "Delete order", exact: true })
      .click();
    await expect(
      desktop.getByText("No orders match your filters."),
    ).toBeVisible({ timeout: 5000 });
    await desktop
      .getByRole("button", { name: "Expenses", exact: true })
      .click();
    await desktop
      .getByRole("button", { name: "Add expense", exact: true })
      .first()
      .click();
    const draft = desktop.getByRole("dialog");
    await draft
      .getByLabel("Description", { exact: true })
      .fill("Unfinished desktop draft");
    await phone.getByRole("button", { name: "Expenses", exact: true }).click();
    await phone
      .getByRole("button", { name: "Add expense", exact: true })
      .first()
      .click();
    form = phone.getByRole("dialog");
    await form
      .getByLabel("Description", { exact: true })
      .fill("Phone live expense");
    await form.getByLabel("Amount ($)", { exact: true }).fill("14.25");
    await form
      .getByRole("button", { name: "Add expense", exact: true })
      .click();
    await expect(desktop.locator("tbody")).toContainText("Phone live expense", {
      timeout: 5000,
    });
    await expect(draft.getByLabel("Description", { exact: true })).toHaveValue(
      "Unfinished desktop draft",
    );
    await draft.getByRole("button", { name: "Cancel", exact: true }).click();
    await phone.getByLabel("Edit charge Phone live expense").click();
    await phone
      .getByRole("dialog")
      .getByLabel("Amount ($)", { exact: true })
      .fill("19.99");
    await phone
      .getByRole("button", { name: "Save charge", exact: true })
      .click();
    await expect(desktop.locator("tbody")).toContainText("$19.99", {
      timeout: 5000,
    });
  } finally {
    await context.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
