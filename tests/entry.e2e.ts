import { test, expect, _electron as electron } from "@playwright/test";
import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PlaywrightEntryDriver,
  entryConfirmation,
  type EntryControl,
} from "../electron/entry/driver";
const url = "https://shop.thirdeyecomics.com/products/fixture";
const profile = {
  label: "Family fixture",
  email: "family@example.com",
  first_name: "Alex",
  last_name: "Smith",
  address: "123 Secret Street",
  city: "Austin",
  state: "TX",
  zip: "78701",
};
const campaign = {
  id: "fixture",
  productKey: "fixture",
  createdAt: "",
  cooldownUntil: 0,
  name: "Test",
  url,
  concurrency: 1 as const,
  browser: "chromium" as const,
  gmailSource: "off" as const,
  senderDomains: ["eql.com"],
  onePerHousehold: false,
};
test("visible browser fills correct profile, handles a code and requires review before confirmed submission", async () => {
  let browser: any,
    intents = 0,
    reviewed = false,
    passedProxy: any;
  const driver = new PlaywrightEntryDriver(async (options) => {
    passedProxy = options?.proxy;
    browser = await chromium.launch({
      ...options,
      channel: undefined,
      proxy: undefined,
    });
    const original = browser.newContext.bind(browser);
    browser.newContext = async (options: any) => {
      const context = await original(options);
      await context.route("**/*", async (route: any) => {
        if (route.request().url() !== url) return route.abort();
        await route.fulfill({
          contentType: "text/html",
          body: `<button id="open">Enter draw</button><form id="newsletter"><input type="email" name="contact[email]"></form><main></main><script>
const main=document.querySelector('main');document.querySelector('#open').onclick=()=>{document.querySelector('#open').remove();main.innerHTML='<input type="email" autocomplete="email"><button id="send">Send code</button>';document.querySelector('#send').onclick=()=>{window.savedEmail=document.querySelector('main input').value;main.innerHTML='<input autocomplete="one-time-code"><button id="verify">Verify code</button>';document.querySelector('#verify').onclick=()=>{window.savedCode=document.querySelector('main input').value;main.innerHTML='<form><input autocomplete="given-name"><input autocomplete="family-name"><input autocomplete="street-address"><input autocomplete="address-level2"><input autocomplete="address-level1"><input autocomplete="postal-code"><button type="button" id="final">Submit entry</button></form>';document.querySelector('#final').onclick=()=>{window.submitted=true;main.innerHTML='<h1>Your entry is confirmed</h1>';};};};};</script>`,
        });
      });
      return context;
    };
    return browser;
  });
  const control: EntryControl = {
    jobId: "fixture",
    signal: new AbortController().signal,
    checkpoint: async () => {},
    stage: () => {},
    code: async () => "123456",
    rateLimit: () => {
      throw Error("Unexpected rate limit");
    },
    intent: () => {
      expect(reviewed).toBe(true);
      intents++;
    },
    wait: async (kind) => {
      const page = browser.contexts()[0].pages()[0];
      if (kind === "manual") return { action: "continue" };
      expect(kind).toBe("review");
      expect(
        await page.evaluate(() => ({
          email: (window as any).savedEmail,
          code: (window as any).savedCode,
          submitted: (window as any).submitted,
        })),
      ).toEqual({ email: profile.email, code: "123456", submitted: undefined });
      expect(
        await page.locator('input[autocomplete="street-address"]').inputValue(),
      ).toBe(profile.address);
      expect(await page.locator("#newsletter input").inputValue()).toBe("");
      reviewed = true;
      return { action: "submit" };
    },
  };
  try {
    const result = await driver.run(
      campaign,
      profile,
      {
        server: "http://proxy.example:8080",
        username: "private-user",
        password: "private-pass",
      },
      control,
    );
    expect(result).toEqual({ kind: "confirmed", rule: "entry-confirmed" });
    expect(intents).toBe(1);
    expect(passedProxy).toEqual({
      server: "http://proxy.example:8080",
      username: "private-user",
      password: "private-pass",
    });
  } finally {
    driver.stop();
  }
});
test("confirmation detection rejects generic thanks and headings outside approved origin", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Thank you</h1>" }),
    );
    await page.goto(url);
    expect(await entryConfirmation(page)).toBeNull();
    await page.goto("https://example.test");
    await page.setContent("<h1>Your entry is confirmed</h1>");
    expect(await entryConfirmation(page)).toBeNull();
  } finally {
    await browser.close();
  }
});
test("desktop exposes Entry Runner, persists queue and fails closed without Windows encryption", async () => {
  const dir = mkdtempSync(join(tmpdir(), "entry-ui-"));
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await page.getByRole("tab", { name: /Entry Runner/ }).click();
    await expect(
      page.getByRole("heading", { name: "Entry Runner.", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "New product queue", exact: true })
      .click();
    await page.getByLabel("Queue name").fill("Family holiday fixture");
    await page.getByLabel("Third Eye product URL").fill(url);
    await page
      .getByRole("button", { name: "Create product queue", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Product queue created",
    );
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    await expect(page.getByLabel("Entry product queue")).toHaveValue(/.+/);
    if (process.platform !== "win32") {
      await expect(
        page.getByText(
          /Profile import and runs require Windows encrypted storage/,
        ),
      ).toBeVisible();
    }
    await page.screenshot({ path: "work/entry-runner.png", fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await page.getByRole("tab", { name: /Entry Runner/ }).click();
    await expect(page.getByLabel("Entry product queue")).toContainText(
      "Family holiday fixture",
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
