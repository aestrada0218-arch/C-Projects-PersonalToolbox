import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("Gmail connection UI, automatic checks, refresh, order review, and disconnect", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-inbox-ui-"));
  const preload = join(dir, "fixture.cjs");
  // Fixture-only preload in an extra test window. Production IPC and credentials are unchanged.
  writeFileSync(
    preload,
    `const {contextBridge}=require('electron');
 const order={id:'11111111-1111-4111-8111-111111111111',name:'Test purchase',store:'Test store',category:'Other',total:25,status:'Processing',date:new Date().toISOString().slice(0,10)};
 let account=null;let shipments=[];let updates=[];
 const state=()=>({account,shipments,updates,syncing:false,supported:true});const result=()=>({ok:true,state:state()});
 contextBridge.exposeInMainWorld('toolbox',{
 snapshot:async()=>({orders:[order],collection:[],tasks:[]}),inboxState:async()=>state(),
 connectGmail:async({email,appPassword})=>{if(appPassword!=='abcdefghijklmnop')return {ok:false,error:'Use a test app password.',state:state()};account={email,auto:false,lastSync:new Date().toISOString(),error:null,scanned:1,skipped:0,limited:false};updates=[{id:'33333333-3333-4333-8333-333333333333',externalId:'forwarded-confirmation',subject:'Fwd: Order #98765432 confirmed',status:'Order confirmed',received:new Date().toISOString(),orderReference:'98765432',orderId:null},{id:'44444444-4444-4444-8444-444444444444',externalId:'forwarded-delivery',subject:'Fwd: Out for delivery 1 item: Example item',status:'Out for delivery',received:new Date().toISOString(),orderReference:null,orderId:null}];shipments=[{id:'22222222-2222-4222-8222-222222222222',tracking:'1Z999AA10123456784',carrier:'UPS',status:'In transit',received:new Date().toISOString(),subject:'Your package has shipped',orderId:null}];return result()},
 setInboxAuto:async auto=>{account.auto=auto;return result()},refreshInbox:async()=>{shipments[0].status='Delivered';return result()},
 linkEmailUpdate:async({updateId,orderId})=>{updates.find(u=>u.id===updateId).orderId=orderId;return result()},linkShipment:async({orderId})=>{shipments[0].orderId=orderId;order.status='Delivered';return result()},disconnectGmail:async()=>{account=null;shipments=[];updates=[];return result()}
 });`,
  );
  const app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    const real = await app.firstWindow();
    await real.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(
      real.getByRole("heading", { name: "Gmail shipment inbox" }),
    ).toBeVisible();
    if (process.platform !== "win32")
      await expect(
        real.getByRole("button", { name: "Connect Gmail securely" }),
      ).toBeDisabled();
    const next = app.waitForEvent("window");
    await app.evaluate(
      async ({ BrowserWindow }, { preload, file }) => {
        const window = new BrowserWindow({
          width: 1440,
          height: 1000,
          webPreferences: {
            preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        await window.loadFile(file);
      },
      { preload, file: join(process.cwd(), "dist/index.html") },
    );
    const page = await next;
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await expect(page.getByLabel("Google app password")).toHaveAttribute(
      "type",
      "password",
    );
    await page.getByLabel("Gmail address").fill("test@gmail.com");
    await page.getByLabel("Google app password").fill("bad-password");
    await page.getByRole("button", { name: "Connect Gmail securely" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Use a test app password",
    );
    await expect(page.getByLabel("Google app password")).toHaveValue("");
    await page.getByLabel("Google app password").fill("abcdefghijklmnop");
    await page.getByRole("button", { name: "Connect Gmail securely" }).click();
    await expect(
      page.getByText("test@gmail.com", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("1Z999AA10123456784", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Fwd: Order #98765432 confirmed", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Fwd: Out for delivery 1 item: Example item", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Order for email 33333333-3333-4333-8333-333333333333")
      .selectOption("11111111-1111-4111-8111-111111111111");
    await page
      .locator("article")
      .filter({ hasText: "Fwd: Order #98765432 confirmed" })
      .getByRole("button", { name: "Apply email status" })
      .click();
    await expect(
      page
        .locator("article")
        .filter({ hasText: "Fwd: Order #98765432 confirmed" }),
    ).toContainText("Linked to an order");
    await page.getByLabel("Check every 10 minutes while app is open").check();
    await expect(
      page.getByLabel("Check every 10 minutes while app is open"),
    ).toBeChecked();
    await page.getByRole("button", { name: "Refresh now" }).click();
    await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
    await page.screenshot({ path: "work/inbox.png", fullPage: true });
    await page
      .getByLabel("Order for 1Z999AA10123456784")
      .selectOption("11111111-1111-4111-8111-111111111111");
    await page.getByRole("button", { name: "Apply status" }).click();
    await expect(
      page.locator("article").filter({ hasText: "1Z999AA10123456784" }),
    ).toContainText("Linked to an order");
    await page.getByRole("button", { name: /^Orders/ }).click();
    await expect(page.locator("tbody")).toContainText("Delivered");
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(
      page.getByText("Remove the saved Gmail credential", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Disconnect and clear inbox" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Connect your Gmail account" }),
    ).toBeVisible();
    await expect(
      page.getByText("1Z999AA10123456784", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
