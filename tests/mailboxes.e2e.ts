import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { Store } = require("../dist-electron/electron/database.js");
test("real IPC: delete order, receive outstanding items into collection, retain dates and persist after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "outstanding-ui-"));
  const store = await Store.open(join(dir, "personal-toolbox.sqlite"));
  store.addOrder({
    name: "Delete this test order",
    store: "Fixture",
    category: "Other",
    total: 25,
    status: "Processing",
    date: "2026-11-16",
  });
  store.mail.ingest(
    "fixture",
    [
      {
        transactionId: "TESTPAYPAL00000001",
        purchaseDate: "2026-11-16",
        lines: [
          {
            description: "ABSOLUTE BATMAN BEYOND ARK-M #1 (ONE SHOT)",
            unitCents: 399,
            quantity: 4,
            amountCents: 1596,
            kind: "item",
          },
          {
            description: "FOC SHIPPING - $4.95 BASE RATE",
            unitCents: 495,
            quantity: 1,
            amountCents: 495,
            kind: "shipping",
          },
        ],
      },
    ],
    { validity: "1", lastUid: 1 },
    { scanned: 1, skipped: 0, limited: false },
  );
  store.close();
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    let page = await app.firstWindow();
    expect(
      await page.evaluate(
        async () => (await window.toolbox!.scanOutstanding()).error,
      ),
    ).toContain("Connect an inbox first.");
    await expect(
      page.getByRole("button", { name: "Proxies", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Profiles", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Orders/ }).click();
    await page.getByLabel("Search orders").fill("Delete this test order");
    await page.getByLabel("Delete order Delete this test order").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(
      page.getByLabel("Delete order Delete this test order"),
    ).toBeVisible();
    await page.getByLabel("Delete order Delete this test order").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete order", exact: true })
      .click();
    await expect(page.getByText("No orders match your filters.")).toBeVisible();
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: /Outstanding orders/ }).click();
    await expect(
      page.getByRole("heading", { name: /Outstanding orders/ }),
    ).toBeVisible();
    await expect(page.locator(".outstanding-orders")).toContainText("$15.96");
    await expect(page.locator(".outstanding-orders")).toContainText(
      "2026-11-16",
    );
    await page.getByRole("button", { name: /Receive ABSOLUTE BATMAN/ }).click();
    await page.getByLabel("Quantity received").fill("2");
    await page.getByLabel("Destination collection").selectOption("comics");
    await page
      .getByRole("button", { name: "Confirm received and move" })
      .click();
    await expect(page.locator(".outstanding-orders tbody")).toContainText(
      "2 / 4",
    );
    await page.getByRole("tab", { name: /Comic books/ }).click();
    await expect(page.locator(".collection-inventory")).toContainText(
      "Purchased 2026-11-16",
    );
    await expect(page.locator(".collection-inventory")).toContainText(
      "ABSOLUTE BATMAN BEYOND",
    );
    await page.getByRole("tab", { name: /Outstanding orders/ }).click();
    await page.screenshot({
      path: "work/outstanding-orders.png",
      fullPage: true,
    });
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: /Outstanding orders/ }).click();
    await expect(page.locator(".outstanding-orders tbody")).toContainText(
      "2 / 4",
    );
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("additional IMAP controls verify connection, clear passwords, toggle monitoring and confirm removal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "imap-ui-")),
    preload = join(dir, "fixture.cjs");
  writeFileSync(
    preload,
    `const {contextBridge}=require('electron');let accounts=[];const state=()=>({accounts,outstanding:[],busy:false,supported:true}),result=()=>({ok:true,state:state()});contextBridge.exposeInMainWorld('toolbox',{snapshot:async()=>({orders:[],collection:[],tasks:[]}),inboxState:async()=>({account:null,shipments:[],updates:[],syncing:false,supported:true}),mailboxState:async()=>state(),connectMailbox:async(v)=>{if(v.password!=='test-private-password')return {ok:false,error:'Fixture sign-in rejected.',state:state()};accounts.push({id:'11111111-1111-4111-8111-111111111111',label:v.label,email:v.email,host:v.host,port:v.port,folder:v.folder,enabled:true,lastSync:null,error:null,scanned:0,skipped:0,limited:false,legacy:false});return result();},setMailboxEnabled:async(v)=>{accounts[0].enabled=v.enabled;return result();},disconnectMailbox:async()=>{accounts=[];return result();},scanMailboxes:async()=>result()});`,
  );
  const app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    await app.firstWindow();
    const next = app.waitForEvent("window");
    await app.evaluate(
      async ({ BrowserWindow }, { preload, file }) => {
        const w = new BrowserWindow({
          width: 1440,
          height: 1000,
          webPreferences: {
            preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        await w.loadFile(file);
      },
      { preload, file: join(process.cwd(), "dist/index.html") },
    );
    const page = await next;
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await page.getByRole("button", { name: "Add IMAP inbox" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: "work/imap-dialog.png", fullPage: true });
    await dialog
      .getByLabel("IMAP provider", { exact: true })
      .selectOption("custom");
    await dialog.getByLabel("Inbox label").fill("Family orders");
    await dialog
      .getByLabel("Email address", { exact: true })
      .fill("family@example.com");
    await dialog.getByLabel("IMAP hostname").fill("imap.example.com");
    await dialog.getByLabel("IMAP password", { exact: true }).fill("wrong");
    await dialog
      .getByRole("button", { name: "Verify and connect inbox" })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Fixture sign-in rejected",
    );
    await expect(
      dialog.getByLabel("IMAP password", { exact: true }),
    ).toHaveValue("");
    await dialog
      .getByLabel("IMAP password", { exact: true })
      .fill("test-private-password");
    await dialog
      .getByRole("button", { name: "Verify and connect inbox" })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".mailbox-manager")).toContainText(
      "imap.example.com:993",
    );
    await page.getByLabel("Monitor Family orders").uncheck();
    await expect(page.getByLabel("Monitor Family orders")).not.toBeChecked();
    await page.getByLabel("Remove inbox Family orders").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove inbox", exact: true })
      .click();
    await expect(page.locator(".mailbox-manager tbody tr")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
