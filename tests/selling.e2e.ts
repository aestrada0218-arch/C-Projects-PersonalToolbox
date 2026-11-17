import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { Store } = require("../dist-electron/electron/database.js");
const { connectionKey } = require("../dist-electron/electron/selling/model.js");
test("real selling IPC: collection draft, exact Mercari link, sale/removal follow-ups and restart persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-selling-ui-"));
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    const name = await page
      .locator(".collection-owned-name strong")
      .first()
      .innerText();
    await page
      .getByRole("button", { name: "Sell item " + name, exact: true })
      .click();
    let form = page.getByRole("dialog");
    await expect(
      form.getByRole("heading", { name: "New shared listing draft" }),
    ).toBeVisible();
    await form
      .getByLabel("Physical copy label", { exact: true })
      .fill("Binder A · UI copy");
    await form
      .getByLabel("Listing title", { exact: true })
      .fill("Example collection sale");
    await form.getByLabel("Selling price (USD)", { exact: true }).fill("25.50");
    await form
      .getByLabel("eBay item condition", { exact: true })
      .selectOption("USED_VERY_GOOD");
    await form
      .getByRole("button", { name: "Save shared draft", exact: true })
      .click();
    let unit = page.getByRole("article", {
      name: "Binder A · UI copy",
      exact: true,
    });
    await expect(unit).toContainText("$25.50");
    await expect(
      unit.getByRole("button", { name: "Prepare / review", exact: true }),
    ).toBeDisabled();
    await unit.getByRole("button", { name: "Copy draft", exact: true }).click();
    expect(
      await app.evaluate(({ clipboard }) => clipboard.readText()),
    ).toContain("Example collection sale");
    await unit
      .getByRole("button", { name: "Link listing", exact: true })
      .click();
    form = page.getByRole("dialog");
    await form
      .getByLabel("Mercari US item URL", { exact: true })
      .fill("https://www.mercari.com/us/item/m123456789/");
    await form
      .getByRole("button", { name: "Save listing link", exact: true })
      .click();
    await expect(form).toBeVisible();
    await form.getByRole("checkbox").check();
    await form
      .getByRole("button", { name: "Save listing link", exact: true })
      .click();
    await expect(unit).toContainText("m123456789");
    await unit
      .getByRole("button", { name: "Record Mercari sale", exact: true })
      .click();
    form = page.getByRole("dialog");
    await form.getByLabel("Confirm selling action", { exact: true }).check();
    await form
      .getByRole("button", { name: "Record Mercari sale", exact: true })
      .click();
    await expect(unit).toContainText("Sold on Mercari");
    await app.close();
    const db = await Store.open(join(dir, "personal-toolbox.sqlite"));
    const source = db.collection.items().find((i: any) => i.quantity >= 2);
    const draft = {
      collectionId: source.id,
      unitLabel: "Binder B · same exact card copy",
      title: "Example follow-up sale",
      description: "Fixture seller item",
      priceCents: 3000,
      condition: "USED_VERY_GOOD",
      conditionDescription: "",
      conditionDescriptors: [],
      aspects: {},
      photoUrls: ["https://i.ebayimg.com/images/fixture.jpg"],
      categoryId: "183454",
      locationKey: "warehouse",
      fulfillmentPolicyId: "1",
      paymentPolicyId: "2",
      returnPolicyId: "3",
      autoEndEbay: true,
    };
    const id = db.selling.create(draft),
      credentials = {
        environment: "sandbox",
        label: "Fixture",
        clientId: "fixture-client-123",
        clientSecret: "fixture-secret-123",
        refreshToken: "fixture-refresh-token-123456789",
      },
      key = connectionKey(credentials);
    db.selling.connect(credentials, key, {
      locations: [],
      fulfillment: [],
      payment: [],
      returns: [],
    });
    db.selling.patch(id, {
      environment: "sandbox",
      connectionKey: key,
      offerId: "1001",
      ebayListingId: "2221001",
      ebayState: "active",
    });
    db.selling.linkMercari({
      id,
      url: "https://www.mercari.com/us/item/m987654321/",
    });
    const saved = db.selling.get(id);
    db.selling.page(
      [
        {
          eventId: "order:line",
          orderId: "12-34567-89012",
          listingId: saved.ebayListingId,
          sku: saved.sku,
          quantity: 1,
          at: new Date().toISOString(),
        },
      ],
      "2026-11-01T00:00:00Z",
      new Date().toISOString(),
      1,
      false,
    );
    db.selling.disconnect();
    db.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Selling", exact: true }).click();
    unit = page.getByRole("article", {
      name: "Binder B · same exact card copy",
      exact: true,
    });
    await expect(unit).toContainText("Remove the linked Mercari listing");
    await expect(unit).toContainText("m987654321");
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url: string) => {
        (globalThis as any).__sellingOpened = url;
      };
    });
    await unit
      .getByRole("button", { name: "Open exact listing", exact: true })
      .click();
    expect(await app.evaluate(() => (globalThis as any).__sellingOpened)).toBe(
      "https://www.mercari.com/us/item/m987654321/",
    );
    await unit
      .getByRole("button", { name: "Confirm inactive", exact: true })
      .click();
    form = page.getByRole("dialog");
    await expect(form).toContainText("does not change Mercari for you");
    await form.getByLabel("Confirm selling action", { exact: true }).check();
    await form
      .getByRole("button", { name: "I deactivated it on Mercari", exact: true })
      .click();
    await expect(unit).not.toContainText("Remove the linked Mercari listing");
    await page.screenshot({
      path: "work/selling-workspace.png",
      fullPage: true,
    });
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Selling", exact: true }).click();
    await expect(
      page.getByRole("article", {
        name: "Binder B · same exact card copy",
        exact: true,
      }),
    ).toContainText("inactive");
    await expect(
      page.getByRole("article", { name: "Binder A · UI copy", exact: true }),
    ).toContainText("Sold on Mercari");
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("eBay publish review UI requires explicit live confirmation and clears rejected credential fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-selling-review-ui-")),
    preload = join(dir, "selling-fixture.cjs");
  writeFileSync(
    preload,
    `const {contextBridge}=require('electron');let count=0;const unit={id:'11111111-1111-4111-8111-111111111111',collectionId:'22222222-2222-4222-8222-222222222222',unitLabel:'Binder C · review copy',title:'Example live listing review',description:'Actual item description',priceCents:2550,condition:'USED_VERY_GOOD',conditionDescription:'See photos',conditionDescriptors:[],aspects:{Brand:['Example']},photoUrls:['https://i.ebayimg.com/images/fixture.jpg'],categoryId:'183454',locationKey:'warehouse',fulfillmentPolicyId:'1',paymentPolicyId:'2',returnPolicyId:'3',autoEndEbay:true,sku:'PT-UNIQUE-COPY',revision:1,environment:'production',connectionKey:'fixture',offerId:'1001',ebayListingId:null,ebayState:'prepared',mercariId:null,mercariState:'unlinked',soldOn:null,soldAt:null,saleReference:null,conflict:false,conflictReviewed:false,error:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const settings={connected:true,supported:true,environment:'production',label:'Fixture seller',connectionKey:'fixture',automatic:false,options:{locations:[{id:'warehouse',name:'Example origin'}],fulfillment:[{id:'1',name:'Example shipping'}],payment:[{id:'2',name:'Example payment'}],returns:[{id:'3',name:'Example returns'}]},lastSync:null,nextSync:null,cooldownUntil:0,error:null};
 const state=()=>({units:[unit],stock:[{id:unit.collectionId,name:unit.title,quantity:1,allocated:1}],settings,busy:false,progress:''});
 contextBridge.exposeInMainWorld('toolbox',{snapshot:async()=>({orders:[],collection:[],tasks:[]}),onTcgProduct:()=>()=>{},sellingState:async()=>state(),sellingCategory:async()=>({ok:true,state:state(),guide:{aspects:[{name:'Brand',required:true,values:['Example']}],conditions:[{id:'4000',name:'Ungraded',descriptors:[{id:'40001',name:'Card Condition',required:true,freeText:false,values:[{id:'400010',name:'Near mint'}]}]}]}}),editSellingDraft:async({draft})=>{Object.assign(unit,draft);unit.revision++;return {ok:true,state:state()}},savedCondition:async()=>unit.conditionDescriptors,connectEbay:async()=>({ok:false,state:state(),error:'Rejected fixture credentials'}),prepareEbayOffer:async()=>({ok:true,state:state(),review:{token:'33333333-3333-4333-8333-333333333333',unit,environment:'production',expiresAt:new Date(Date.now()+600000).toISOString(),options:settings.options}}),publishEbayOffer:async(input)=>{if(input.confirmed!==true)return {ok:false,state:state(),error:'Missing confirmation'};count++;unit.ebayState='active';unit.ebayListingId='2221001';return {ok:true,state:state()}},publicationCount:async()=>count});`,
  );
  const app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    await app.firstWindow();
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
    await page.getByRole("button", { name: "Selling", exact: true }).click();
    await page
      .getByRole("button", { name: "eBay connection", exact: true })
      .click();
    let form = page.getByRole("dialog");
    await form
      .getByLabel("eBay Client ID", { exact: true })
      .fill("fixture-client-123");
    await form
      .getByLabel("eBay Client secret", { exact: true })
      .fill("fixture-secret-123");
    await form
      .getByLabel("eBay seller refresh token", { exact: true })
      .fill("fixture-refresh-token-123456789");
    await form
      .getByRole("button", { name: "Verify and save connection", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText(
      "Rejected fixture credentials",
    );
    await expect(
      form.getByLabel("eBay Client secret", { exact: true }),
    ).toHaveValue("");
    await expect(
      form.getByLabel("eBay seller refresh token", { exact: true }),
    ).toHaveValue("");
    await form
      .getByRole("button", { name: "Close selling dialog", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Edit listing draft Example live listing review",
        exact: true,
      })
      .click();
    form = page.getByRole("dialog");
    await form
      .getByRole("button", { name: "Load category fields", exact: true })
      .click();
    await form
      .getByLabel("Card Condition", { exact: true })
      .selectOption("400010");
    await expect(
      form.getByLabel("Specific name 1", { exact: true }),
    ).toHaveValue("Brand");
    await form
      .getByRole("button", { name: "Save shared draft", exact: true })
      .click();
    expect(
      await page.evaluate(async () => (window.toolbox as any).savedCondition()),
    ).toEqual([{ name: "40001", values: ["400010"] }]);
    await page
      .getByRole("button", { name: "Prepare / review", exact: true })
      .click();
    form = page.getByRole("dialog");
    await expect(form).toContainText("LIVE EBAY PUBLICATION");
    await expect(form).toContainText("$25.50");
    await expect(form).toContainText("Example shipping");
    await form
      .getByRole("button", { name: "Publish live eBay listing", exact: true })
      .click();
    expect(
      await page.evaluate(async () =>
        (window.toolbox as any).publicationCount(),
      ),
    ).toBe(0);
    await form
      .getByLabel("Confirm eBay publication details", { exact: true })
      .check();
    await form
      .getByRole("button", { name: "Publish live eBay listing", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    expect(
      await page.evaluate(async () =>
        (window.toolbox as any).publicationCount(),
      ),
    ).toBe(1);
    await expect(
      page.getByRole("article", {
        name: "Binder C · review copy",
        exact: true,
      }),
    ).toContainText("Listing 2221001");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
