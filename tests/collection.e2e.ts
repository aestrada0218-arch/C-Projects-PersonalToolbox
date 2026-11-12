import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("real collection IPC: manual comics, local photo, editing, value history and restart persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-comics-ui-"));
  const photo = join(dir, "photo.png");
  writeFileSync(
    photo,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAAMklEQVR4nO3NMQEAMAjAsDFx2MALyjEBXyqgiax+l/3TOwAAAAAAAAAAAAAAAAAAYLkBb14Bhw8dBlAAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  let app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: /Comic books/ }).click();
    await page.getByRole("button", { name: "Add comic", exact: true }).click();
    const form = page.getByRole("dialog");
    await form
      .getByLabel("Item name", { exact: true })
      .fill("Example Comic #1");
    await form.getByLabel("Quantity owned", { exact: true }).fill("2");
    await form
      .getByLabel("Unit purchase price ($)", { exact: true })
      .fill("5.00");
    await form
      .getByLabel("Unit value estimate ($)", { exact: true })
      .fill("10.00");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, photo);
    await form.getByRole("button", { name: "Add your photo" }).click();
    await expect(
      form.getByRole("img", { name: "Selected collection photo" }),
    ).toBeVisible();
    await form.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(page.locator(".collection-inventory tbody tr")).toHaveCount(1);
    await expect(page.locator(".collection-inventory tbody")).toContainText(
      "$10.00",
    );
    await expect(
      page.getByRole("img", { name: "Example Comic #1", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit item Example Comic #1", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Unit value estimate ($)", { exact: true })
      .fill("12.00");
    await page
      .getByRole("dialog")
      .getByLabel("Quantity owned", { exact: true })
      .fill("3");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save item" })
      .click();
    await expect(page.locator(".collection-inventory tbody")).toContainText(
      "$12.00",
    );
    await page
      .getByRole("button", {
        name: "Value history Example Comic #1",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: "Close collection dialog" }).click();
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: /Comic books/ }).click();
    await expect(page.locator(".collection-inventory tbody")).toContainText(
      "$12.00",
    );
    await expect(
      page.getByRole("img", { name: "Example Comic #1", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Delete item Example Comic #1",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.locator(".collection-inventory tbody tr")).toHaveCount(1);
    await page
      .getByRole("button", {
        name: "Delete item Example Comic #1",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove item", exact: true })
      .click();
    await expect(page.locator(".collection-inventory tbody tr")).toHaveCount(0);
    expect(
      await page.evaluate(
        async () => (await window.toolbox!.snapshot()).collection.length,
      ),
    ).toBe(6);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("TCGplayer opens isolated, blocks outside navigation, and passes only the selected product ID back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-browser-ui-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    await app.context().route("https://www.tcgplayer.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><title>Fixture TCG catalog</title><a href="https://www.tcgplayer.com/product/12345/example">Example product</a><a href="https://example.org/">Outside site</a>',
      }),
    );
    let outside = false;
    await app.context().route("https://example.org/**", (route) => {
      outside = true;
      return route.fulfill({ body: "outside" });
    });
    await app.evaluate(({ Menu }) => {
      const original = Menu.buildFromTemplate;
      Menu.buildFromTemplate = (template: any) => {
        const menu = original(template);
        (globalThis as any).__collectionTestMenu = menu;
        return menu;
      };
    });
    const main = await app.firstWindow();
    await main.getByRole("button", { name: "Collection", exact: true }).click();
    await main.getByRole("tab", { name: /TCGplayer/ }).click();
    const next = app.waitForEvent("window");
    await main.getByRole("button", { name: "Browse TCGplayer" }).click();
    const catalog = await next;
    await catalog.getByRole("link", { name: "Example product" }).click();
    await expect(catalog).toHaveURL(
      "https://www.tcgplayer.com/product/12345/example",
    );
    expect(
      await catalog.evaluate(() => ({
        node: typeof (window as any).require,
        bridge: typeof (window as any).toolbox,
      })),
    ).toEqual({ node: "undefined", bridge: "undefined" });
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const remote = BrowserWindow.getAllWindows().find((w) =>
        w.getParentWindow(),
      )!;
      const p = remote.webContents.getLastWebPreferences();
      return {
        node: p.nodeIntegration,
        isolation: p.contextIsolation,
        sandbox: p.sandbox,
        preload: p.preload || "",
        persistent: remote.webContents.session.isPersistent(),
        sharesMainSession:
          remote.webContents.session ===
          remote.getParentWindow()!.webContents.session,
      };
    });
    expect(prefs).toMatchObject({
      node: false,
      isolation: true,
      sandbox: true,
      preload: "",
    });
    expect(prefs.persistent).toBe(false);
    expect(prefs.sharesMainSession).toBe(false);
    await app.evaluate(({ BrowserWindow }) => {
      const remote = BrowserWindow.getAllWindows().find((w) =>
        w.getParentWindow(),
      )!;
      remote.webContents.on("will-navigate", (_event, url) => {
        if (url === "https://example.org/")
          (globalThis as any).__outsideNavigationBlocked = true;
      });
    });
    await catalog
      .getByRole("link", { name: "Outside site" })
      .click({ noWaitAfter: true });
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as any).__outsideNavigationBlocked),
      )
      .toBe(true);
    // Canceled native navigation leaves Playwright's pending frame URL empty.
    // Check Electron's committed document, not that canceled navigation target.
    const committed = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getParentWindow())!
        .webContents.getURL(),
    );
    expect(committed).toBe("https://www.tcgplayer.com/product/12345/example");
    expect(outside).toBe(false);
    await app.evaluate(() => {
      const menu = (globalThis as any).__collectionTestMenu;
      const item = menu.items[0].submenu.items.find(
        (i: any) => i.label === "Look up this product in Personal Toolbox",
      );
      if (!item?.enabled) throw Error("Product menu disabled");
      item.click();
    });
    await expect(main.getByLabel("Search card catalog")).toHaveValue("12345");
    await expect(main.getByRole("alert")).toContainText("Connect JustTCG");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("catalog UI: key validation, variant choice, add, manual quote refresh, expired data and retained history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "toolbox-catalog-ui-"));
  const preload = join(dir, "catalog-fixture.cjs");
  writeFileSync(
    preload,
    `const{contextBridge}=require('electron');let connected=false;let items=[];let quotes=[];let count=0;
 const settings=()=>({connected,supported:true,games:[{id:'pokemon',name:'Pokemon'}],cooldownUntil:0,dailyRemaining:90,monthlyRemaining:900});const state=()=>({items,settings:settings(),busy:false,progress:''});const result=()=>({ok:true,state:state()});
 const variant={id:'variant-stable',selectionId:'11111111-1111-4111-8111-111111111111',condition:'Near Mint',printing:'Normal',language:'English',valueCents:1234,lastKnownCents:null,observedAt:new Date().toISOString(),state:'current'};
 const card={id:'card-stable',name:'Example Dragon',game:'Pokemon',setName:'Example Set',number:'001',productId:'12345',checkedAt:new Date().toISOString(),variants:[variant,{...variant,id:'variant-foil',selectionId:'22222222-2222-4222-8222-222222222222',printing:'Foil',valueCents:2000}]};
 contextBridge.exposeInMainWorld('toolbox',{
 snapshot:async()=>({orders:[],collection:items.map(i=>({...i,purchase:i.purchaseCents/100,market:(i.valueCents||0)/100,marketKnown:i.valueCents===null?0:1})),tasks:[]}),collectionState:async()=>state(),collectionBrowserState:async()=>({open:false,productId:null,url:null}),onTcgProduct:()=>()=>{},openCollectionProvider:async()=>true,
 connectPricing:async key=>{if(key!=='tcg_test_example_key_12345')return {ok:false,error:'Provider rejected test key.',state:state()};connected=true;return result()},disconnectPricing:async()=>{connected=false;return result()},searchCatalog:async()=>({ok:true,cards:[card],hasMore:false,settings:settings()}),
 addCatalogItem:async({selectionId,quantity,purchaseCents})=>{const v=card.variants.find(v=>v.selectionId===selectionId);const item={id:'33333333-3333-4333-8333-333333333333',name:card.name,category:card.game,collectionType:'cards',quantity,purchaseCents,valueCents:v.valueCents,lastKnownCents:v.valueCents,provider:'justtcg',cardId:card.id,variantId:v.id,productId:'12345',condition:v.condition,printing:v.printing,language:v.language,setName:card.setName,referenceUrl:'https://www.tcgplayer.com/product/12345',imageData:null,state:'current',observedAt:v.observedAt,checkedAt:card.checkedAt,error:null};items.push(item);quotes=[{id:'q0',itemId:item.id,valueCents:item.valueCents,state:'current',checkedAt:card.checkedAt,observedAt:v.observedAt,source:'JustTCG'}];return result()},
 refreshCollection:async()=>{count++;const item=items[0];item.valueCents=count===1?1500:null;item.lastKnownCents=1500;item.state=count===1?'current':'expired';item.checkedAt=new Date().toISOString();quotes.push({id:'q'+count,itemId:item.id,valueCents:item.valueCents,state:item.state,checkedAt:item.checkedAt,observedAt:item.observedAt,source:'JustTCG'});return {...result(),updated:1,failed:0}},collectionHistory:async()=>quotes.slice().reverse(),deleteCollectible:async()=>{items=[];quotes=[];return result()}
 });`,
  );
  const app = await electron.launch({ args: [".", `--user-data-dir=${dir}`] });
  try {
    await app.firstWindow();
    const next = app.waitForEvent("window");
    await app.evaluate(
      async ({ BrowserWindow }, { preload, file }) => {
        const fixture = new BrowserWindow({
          width: 1440,
          height: 1000,
          webPreferences: {
            preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        await fixture.loadFile(file);
      },
      { preload, file: join(process.cwd(), "dist/index.html") },
    );
    const page = await next;
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    await page.getByRole("tab", { name: /TCGplayer/ }).click();
    await page
      .getByRole("button", { name: "Connect pricing", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("JustTCG API key", { exact: true })
      .fill("tcg_bad_example_key");
    await dialog
      .getByRole("button", { name: "Connect pricing", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("rejected test key");
    await expect(
      dialog.getByLabel("JustTCG API key", { exact: true }),
    ).toHaveValue("");
    await dialog
      .getByLabel("JustTCG API key", { exact: true })
      .fill("tcg_test_example_key_12345");
    await dialog
      .getByRole("button", { name: "Connect pricing", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.getByLabel("Search card catalog").fill("Example Dragon");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".catalog-card")).toHaveCount(1);
    await expect(
      page
        .locator(".catalog-card")
        .getByRole("button", { name: "Add to collection", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Variant for Example Dragon")
      .selectOption("variant-stable");
    await page
      .locator(".catalog-card")
      .getByRole("button", { name: "Add to collection", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Quantity owned", { exact: true })
      .fill("2");
    await page
      .getByRole("dialog")
      .getByLabel("Unit purchase price ($)", { exact: true })
      .fill("10.00");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add to collection", exact: true })
      .click();
    await expect(page.locator(".collection-inventory tbody tr")).toHaveCount(1);
    await expect(
      page.getByRole("article", { name: "Known market value", exact: true }),
    ).toContainText("$24.68");
    await page
      .getByRole("button", {
        name: "Refresh value Example Dragon",
        exact: true,
      })
      .click();
    await expect(page.locator(".collection-inventory tbody")).toContainText(
      "$15.00",
    );
    await expect(
      page.getByRole("article", { name: "Known market value", exact: true }),
    ).toContainText("$30.00");
    await page.screenshot({
      path: "work/collection-cards.png",
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: "Refresh value Example Dragon",
        exact: true,
      })
      .click();
    await expect(page.locator(".collection-inventory tbody")).toContainText(
      "Expired quote",
    );
    await expect(page.locator(".collection-inventory tbody")).toContainText(
      "Last recorded: $15.00",
    );
    await expect(
      page.getByRole("article", { name: "Known market value", exact: true }),
    ).toContainText("$0.00");
    await page
      .getByRole("button", {
        name: "Value history Example Dragon",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(3);
    await page.getByRole("button", { name: "Close collection dialog" }).click();
    await page
      .getByRole("button", { name: "Pricing connection", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Disconnect pricing" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await expect(page.locator(".collection-inventory tbody tr")).toHaveCount(1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
