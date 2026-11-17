import {
  chromium,
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Frame,
  type Locator,
  type Page,
} from "playwright";
import type { EntryCampaign, EntryProfile } from "../../src/entry-types";
import { allowedEntryUrl } from "./model";
import { abortDelay } from "./codes";
export type ProxySecret = {
  server: string;
  username: string;
  password: string;
};
export type DriverAnswer = {
  action: "continue" | "submit" | "skip";
  code?: string;
};
export interface EntryControl {
  jobId: string;
  signal: AbortSignal;
  checkpoint(): Promise<void>;
  stage(name: string): void;
  wait(
    kind: "manual" | "code" | "review" | "verify",
    message: string,
  ): Promise<DriverAnswer>;
  code(since: number): Promise<string | null>;
  intent(): void;
  rateLimit(until: number): void;
}
export type DriverOutcome = {
  kind: "confirmed" | "existing" | "needs-review" | "skipped";
  rule?: "entry-confirmed" | "existing-entry";
};
export interface EntryDriver {
  focus?(jobId: string): Promise<void>;
  run(
    campaign: EntryCampaign,
    profile: EntryProfile,
    proxy: ProxySecret | null,
    control: EntryControl,
    reviewOnly?: boolean,
  ): Promise<DriverOutcome>;
  testProxy(proxy: ProxySecret, signal: AbortSignal): Promise<boolean>;
  stop(): void;
}
const confirmNames =
  /^(?:your entry (?:is |has been )?(?:confirmed|received|submitted)|entry (?:confirmed|received|submitted)|you(?:'|’)re entered[!.]?|you are entered[!.]?)$/i;
const existingNames =
  /^(?:you(?:'|’)ve already entered[!.]?|you have already entered[!.]?|you are already entered[!.]?|entry already submitted[!.]?)$/i;
export async function entryConfirmation(
  page: Page,
): Promise<"entry-confirmed" | "existing-entry" | null> {
  for (const frame of page.frames().filter((f) => allowedEntryUrl(f.url()))) {
    if (
      await frame
        .getByRole("heading", { name: existingNames })
        .first()
        .isVisible()
        .catch(() => false)
    )
      return "existing-entry";
    if (
      await frame
        .getByRole("heading", { name: confirmNames })
        .first()
        .isVisible()
        .catch(() => false)
    )
      return "entry-confirmed";
  }
  return null;
}
const selectors = {
  email: [
    "input[type=email]",
    "input[autocomplete=email]",
    "input[name=email]",
  ],
  code: [
    "input[autocomplete=one-time-code]",
    "input[name=verificationCode i]",
    "input[name=verification_code i]",
    "input[name=passcode i]",
    "input[name=otp i]",
    "input[name='code' i]",
    "input[id='code' i]",
  ],
  first: [
    "input[autocomplete=given-name]",
    "input[name=firstName]",
    "input[name=first_name]",
  ],
  last: [
    "input[autocomplete=family-name]",
    "input[name=lastName]",
    "input[name=last_name]",
  ],
  address: [
    "input[autocomplete=address-line1]",
    "input[autocomplete=street-address]",
    "input[name=address1]",
    "input[name=address]",
  ],
  city: ["input[autocomplete=address-level2]", "input[name=city]"],
  state: [
    "input[autocomplete=address-level1]",
    "input[name=state]",
    "select[name=state]",
    "select[autocomplete=address-level1]",
  ],
  zip: [
    "input[autocomplete=postal-code]",
    "input[name=zip]",
    "input[name=zipcode]",
    "input[name=postalCode]",
  ],
};
export class PlaywrightEntryDriver implements EntryDriver {
  private browsers = new Set<Browser>();
  private requests = new Set<APIRequestContext>();
  private pages = new Map<string, () => Page>();
  async focus(jobId: string) {
    const get = this.pages.get(jobId);
    if (!get) throw Error("ENTRY_BROWSER_CLOSED");
    await get().bringToFront();
  }
  constructor(
    private launch: typeof chromium.launch = (options) =>
      chromium.launch(options),
  ) {}
  stop() {
    for (const b of this.browsers) void b.close().catch(() => {});
    this.browsers.clear();
    for (const context of this.requests) void context.dispose().catch(() => {});
    this.requests.clear();
  }
  private frames(page: Page) {
    return page
      .frames()
      .filter((f) => allowedEntryUrl(f.url()))
      .sort((a, b) => {
        const priority = (f: Frame) => {
          const host = new URL(f.url()).hostname;
          return host === "eql.com" || host.endsWith(".eql.com")
            ? 0
            : f.parentFrame()
              ? 1
              : 2;
        };
        return priority(a) - priority(b);
      });
  }
  private async field(page: Page, list: string[]): Promise<Locator | null> {
    for (const frame of this.frames(page))
      for (const selector of list) {
        const fields = frame.locator(selector);
        for (let i = 0; i < Math.min(await fields.count(), 10); i++) {
          const field = fields.nth(i);
          const newsletter = await field
            .evaluate((e) =>
              /newsletter|subscribe|contact\[email\]/i.test(
                [
                  e.getAttribute("name"),
                  e.id,
                  e.closest("form")?.id,
                  e.closest("form")?.getAttribute("action"),
                ].join(" "),
              ),
            )
            .catch(() => true);
          if (
            !newsletter &&
            (await field.isVisible().catch(() => false)) &&
            (await field.isEditable().catch(() => false))
          )
            return field;
        }
      }
    return null;
  }
  private async button(page: Page, name: RegExp, links = false) {
    for (const frame of this.frames(page)) {
      const candidates = links
        ? frame
            .getByRole("link", { name })
            .or(frame.getByRole("button", { name }))
        : frame.getByRole("button", { name });
      const visible: Locator[] = [];
      for (let i = 0; i < Math.min(await candidates.count(), 10); i++)
        if (
          await candidates
            .nth(i)
            .isVisible()
            .catch(() => false)
        )
          visible.push(candidates.nth(i));
      if (visible.length === 1) return visible[0];
    }
    return null;
  }
  private async fill(page: Page, list: string[], value: string) {
    const field = await this.field(page, list);
    if (!field) return false;
    const tag = await field.evaluate((e) => e.tagName);
    if (tag === "SELECT") {
      try {
        await field.selectOption({ value }, { timeout: 1500 });
      } catch {
        await field.selectOption({ label: value }, { timeout: 1500 });
      }
    } else await field.fill(value, { timeout: 3000 });
    return true;
  }
  async testProxy(proxy: ProxySecret, signal: AbortSignal) {
    if (signal.aborted) return false;
    const context = await request.newContext({
      proxy: {
        server: proxy.server,
        ...(proxy.username
          ? { username: proxy.username, password: proxy.password }
          : {}),
      },
      ignoreHTTPSErrors: false,
      timeout: 20000,
    });
    this.requests.add(context);
    const abort = () => void context.dispose().catch(() => {});
    signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await context.get("https://shop.thirdeyecomics.com/", {
        maxRedirects: 0,
      });
      return response.status() >= 200 && response.status() < 400;
    } catch {
      return false;
    } finally {
      signal.removeEventListener("abort", abort);
      this.requests.delete(context);
      await context.dispose().catch(() => {});
    }
  }
  async run(
    campaign: EntryCampaign,
    profile: EntryProfile,
    proxy: ProxySecret | null,
    control: EntryControl,
    reviewOnly = false,
  ): Promise<DriverOutcome> {
    await control.checkpoint();
    const browser = await this.launch({
      headless: false,
      ...(campaign.browser !== "chromium" ? { channel: campaign.browser } : {}),
      ...(proxy
        ? {
            proxy: {
              server: proxy.server,
              ...(proxy.username
                ? { username: proxy.username, password: proxy.password }
                : {}),
            },
          }
        : {}),
      chromiumSandbox: process.platform === "win32",
      timeout: 30000,
    });
    this.browsers.add(browser);
    const close = () => void browser.close().catch(() => {});
    control.signal.addEventListener("abort", close, { once: true });
    let context: BrowserContext | undefined,
      restricted = false,
      blocked = false;
    try {
      if (control.signal.aborted) throw Error("ENTRY_STOP");
      context = await browser.newContext({
        ignoreHTTPSErrors: false,
        acceptDownloads: false,
        permissions: [],
        serviceWorkers: "block",
      });
      await context.route("**/*", async (route) => {
        const request = route.request();
        let top = false;
        try {
          top = request.isNavigationRequest() && !request.frame().parentFrame();
        } catch {}
        if (top && !allowedEntryUrl(request.url())) {
          restricted = true;
          await route.abort();
          return;
        }
        await route.fallback();
      });
      context.on("response", (response) => {
        let top = false;
        try {
          top =
            response.request().isNavigationRequest() &&
            !response.request().frame().parentFrame();
        } catch {}
        if (!top) return;
        if (response.status() === 429) {
          blocked = true;
          const value = response.headers()["retry-after"],
            seconds = Number(value),
            time = Date.parse(value || "");
          try {
            control.rateLimit(
              Math.max(
                Date.now() + 60000,
                Number.isFinite(seconds) && seconds >= 0
                  ? Date.now() + seconds * 1000
                  : Number.isFinite(time)
                    ? time
                    : 0,
              ),
            );
          } catch {
            void context?.close().catch(() => {});
          }
        } else if ([401, 403].includes(response.status())) blocked = true;
      });
      let page = await context.newPage();
      this.pages.set(control.jobId, () => page);
      control.stage("Opening product");
      await page.goto(campaign.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const current = () => {
        const pages = context!
          .pages()
          .filter((p) => !p.isClosed() && allowedEntryUrl(p.url()));
        if (pages.length) page = pages[pages.length - 1];
        return page;
      };
      const manual = async (
        message: string,
        kind: "manual" | "verify" = "manual",
      ) => {
        const answer = await control.wait(kind, message);
        if (answer.action === "skip") return false;
        current();
        return true;
      };
      if (reviewOnly) {
        for (let n = 0; n < 5; n++) {
          if (
            !(await manual(
              "Open the existing entry confirmation for this exact person and product in the browser, then verify it here. No new entry will be submitted.",
              "verify",
            ))
          )
            return { kind: "skipped" };
          const confirmation = await entryConfirmation(current());
          if (confirmation)
            return {
              kind:
                confirmation === "existing-entry" ? "existing" : "confirmed",
              rule: confirmation,
            };
        }
        return { kind: "needs-review" };
      }
      let requestedAt = Date.now(),
        emailSent = false,
        codeHandled = false,
        opened = false,
        filled = false;
      for (let step = 0; step < 12; step++) {
        await control.checkpoint();
        current();
        if (page.isClosed()) throw Error("ENTRY_BROWSER_CLOSED");
        if (restricted) {
          restricted = false;
          if (
            !(await manual(
              "A page outside the approved Third Eye/EQL domains was blocked. Return to the correct launch in this browser before continuing.",
            ))
          )
            return { kind: "skipped" };
          continue;
        }
        if (
          blocked ||
          (await page
            .getByText(
              /^(?:verify (?:that )?you are human|verify you're human|access denied|too many requests|complete the captcha)$/i,
            )
            .first()
            .isVisible()
            .catch(() => false))
        ) {
          if (
            !(await manual(
              "The site requires your attention or has limited access. Complete any permitted verification manually in the browser. Proxies will not be changed or retried to bypass it.",
            ))
          )
            return { kind: "needs-review" };
          blocked = false;
          continue;
        }
        const prior = await entryConfirmation(page);
        if (prior === "existing-entry")
          return { kind: "existing", rule: prior };
        if (!opened && !emailSent && !codeHandled && !filled) {
          const opener = await this.button(page, /^enter draw$/i, true);
          if (opener) {
            const isEntryForm = await opener
              .evaluate((el) =>
                Boolean(
                  el
                    .closest("form")
                    ?.querySelector(
                      "input[type=email],input[autocomplete=given-name],input[autocomplete=one-time-code]",
                    ),
                ),
              )
              .catch(() => true);
            if (!isEntryForm) {
              control.stage("Opening draw");
              await opener.click({ timeout: 5000 });
              opened = true;
              await abortDelay(1200, control.signal);
              continue;
            }
          }
        }
        const emailField = await this.field(page, selectors.email);
        if (emailField && !emailSent) {
          control.stage("Filling email");
          await emailField.fill(profile.email, { timeout: 3000 });
          emailSent = true;
          const next = await this.button(
            page,
            /^(?:continue|send (?:me )?(?:a )?code|next)$/i,
          );
          if (next) {
            requestedAt = Date.now();
            await control.checkpoint();
            await next.click({ timeout: 5000 });
            await abortDelay(1200, control.signal);
            continue;
          }
        }
        const codeField = await this.field(page, selectors.code);
        const boxes = this.frames(page).map((f) =>
          f.locator("input[maxlength='1'][inputmode='numeric']"),
        );
        let codeBoxes: Locator | null = null;
        for (const b of boxes)
          if (
            (await b.count()) >= 4 &&
            (await b
              .first()
              .isVisible()
              .catch(() => false))
          ) {
            codeBoxes = b;
            break;
          }
        if ((codeField || codeBoxes) && !codeHandled) {
          control.stage("Waiting for verification code");
          let code = await control.code(requestedAt);
          await control.checkpoint();
          if (!code) {
            const answer = await control.wait(
              "code",
              "A fresh matching Gmail code was not available. Enter the code here, or complete verification in the browser and Continue.",
            );
            if (answer.action === "skip") return { kind: "skipped" };
            code = answer.code || null;
          }
          if (code) {
            if (codeField) await codeField.fill(code, { timeout: 3000 });
            else if (codeBoxes && (await codeBoxes.count()) === code.length) {
              for (let i = 0; i < code.length; i++)
                await codeBoxes.nth(i).fill(code[i], { timeout: 3000 });
            } else {
              if (
                !(await manual(
                  "Enter the verification code in the browser, then Continue.",
                ))
              )
                return { kind: "skipped" };
            }
            const verify = await this.button(
              page,
              /^(?:verify(?: code)?|continue|next)$/i,
            );
            if (verify) {
              await control.checkpoint();
              await verify.click({ timeout: 5000 });
            }
          }
          codeHandled = true;
          await abortDelay(1200, control.signal);
          continue;
        }
        if (!filled) {
          control.stage("Filling profile");
          let count = 0;
          for (const [list, value] of [
            [selectors.first, profile.first_name],
            [selectors.last, profile.last_name],
            [selectors.city, profile.city],
            [selectors.state, profile.state],
            [selectors.zip, profile.zip],
          ] as [string[], string][])
            if (await this.fill(page, list, value)) count++;
          const address = await this.field(page, selectors.address);
          if (address) {
            await address.fill(profile.address, { timeout: 3000 });
            await abortDelay(700, control.signal);
            let chosen = false;
            const normalized = (v: string) =>
              v.toLowerCase().replace(/[^a-z0-9]/g, "");
            const street = normalized(profile.address),
              zip = profile.zip.slice(0, 5);
            for (const f of this.frames(page)) {
              const options = f.getByRole("option");
              for (let i = 0; i < Math.min(await options.count(), 15); i++) {
                const option = options.nth(i);
                if (!(await option.isVisible().catch(() => false))) continue;
                const text = await option.innerText();
                if (normalized(text).includes(street) && text.includes(zip)) {
                  await option.click({ timeout: 3000 });
                  chosen = true;
                  break;
                }
              }
              if (chosen) break;
            }
            if (
              !chosen &&
              !(await manual(
                "Review the shipping address and choose the correct autocomplete suggestion in the browser if required. Continue when the address is correct.",
              ))
            )
              return { kind: "skipped" };
            count++;
          }
          if (count) {
            filled = true;
            const next = await this.button(current(), /^(?:continue|next)$/i);
            if (next) {
              await control.checkpoint();
              await next.click({ timeout: 5000 });
              await abortDelay(1200, control.signal);
              continue;
            }
          }
        }
        const final = await this.button(
          page,
          /^(?:enter draw|enter launch|submit entry)$/i,
        );
        if (final && (emailSent || codeHandled || filled || opened)) {
          const answer = await control.wait(
            "review",
            "Review this exact person's account, product, address, eligibility, selected options, and any payment obligation in the browser. Submit only when all details and the site's entry limits are correct.",
          );
          if (answer.action === "skip") return { kind: "skipped" };
          if (answer.action !== "submit") continue;
          await control.checkpoint();
          const visibleEmail = await this.field(current(), selectors.email);
          if (
            visibleEmail &&
            (await visibleEmail.inputValue()).trim().toLowerCase() !==
              profile.email
          )
            throw Error("ENTRY_ACCOUNT_MISMATCH");
          control.intent();
          await final.click({ timeout: 10000 });
          control.stage("Checking submission confirmation");
          for (let n = 0; n < 20; n++) {
            await control.checkpoint();
            const confirmation = await entryConfirmation(current());
            if (confirmation)
              return {
                kind:
                  confirmation === "existing-entry" ? "existing" : "confirmed",
                rule: confirmation,
              };
            await abortDelay(500, control.signal);
          }
          for (let n = 0; n < 3; n++) {
            if (
              !(await manual(
                "A click was sent, but the site has not shown a recognized entry confirmation. Check this exact entry in the browser, then Verify. Do not submit it again.",
                "verify",
              ))
            )
              return { kind: "needs-review" };
            const result = await entryConfirmation(current());
            if (result)
              return {
                kind: result === "existing-entry" ? "existing" : "confirmed",
                rule: result,
              };
          }
          return { kind: "needs-review" };
        }
        if (!opened && !emailSent && !codeHandled && !filled) {
          const launch = await this.button(page, /^enter draw$/i, true);
          if (launch) {
            control.stage("Opening draw");
            await launch.click({ timeout: 5000 });
            opened = true;
            await abortDelay(1200, control.signal);
            continue;
          }
        }
        if (
          !(await manual(
            "Complete any missing fields, verification, or payment step in the browser. The runner does not fill payment details or solve access challenges. Continue when the next entry step is ready.",
          ))
        )
          return { kind: "skipped" };
      }
      return { kind: "needs-review" };
    } finally {
      this.pages.delete(control.jobId);
      control.signal.removeEventListener("abort", close);
      this.browsers.delete(browser);
      await context?.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}
