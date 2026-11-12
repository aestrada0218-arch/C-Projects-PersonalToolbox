import { BrowserWindow, Menu, session, shell } from "electron";
import { randomUUID } from "node:crypto";
import { allowedTcgNavigation, tcgProductId } from "./model";
import type { CollectionBrowserState } from "../../src/collection-types";
export class TcgCatalogBrowser {
  private window: BrowserWindow | null = null;
  constructor(private owner: () => BrowserWindow) {}
  state(): CollectionBrowserState {
    const open = Boolean(this.window && !this.window.isDestroyed());
    const url = open ? this.window!.webContents.getURL() : null;
    return { open, url, productId: url ? tcgProductId(url) : null };
  }
  open(url = "https://www.tcgplayer.com/categories") {
    if (!allowedTcgNavigation(url)) throw Error("Invalid catalog URL");
    if (this.window && !this.window.isDestroyed()) {
      void this.window.loadURL(url).catch(() => {});
      this.window.show();
      return;
    }
    const partition = "tcg-catalog-" + randomUUID();
    const isolated = session.fromPartition(partition);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    isolated.setPermissionCheckHandler(() => false);
    isolated.on("will-download", (event) => event.preventDefault());
    const browser = new BrowserWindow({
      parent: this.owner(),
      width: 1200,
      height: 850,
      title: "TCGplayer catalog · Personal Toolbox",
      backgroundColor: "#101318",
      autoHideMenuBar: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        allowRunningInsecureContent: false,
      },
    });
    this.window = browser;
    const menu = () =>
      browser.setMenu(
        Menu.buildFromTemplate([
          {
            label: "Catalog",
            submenu: [
              {
                label: "Categories",
                click: () =>
                  void browser
                    .loadURL("https://www.tcgplayer.com/categories")
                    .catch(() => {}),
              },
              {
                label: "Back",
                enabled: browser.webContents.navigationHistory.canGoBack(),
                click: () => browser.webContents.navigationHistory.goBack(),
              },
              {
                label: "Forward",
                enabled: browser.webContents.navigationHistory.canGoForward(),
                click: () => browser.webContents.navigationHistory.goForward(),
              },
              { type: "separator" },
              {
                label: "Look up this product in Personal Toolbox",
                enabled: Boolean(tcgProductId(browser.webContents.getURL())),
                click: () => {
                  const id = tcgProductId(browser.webContents.getURL());
                  if (id) {
                    this.owner().webContents.send("toolbox:tcg-product", id);
                    this.owner().show();
                    this.owner().focus();
                    browser.hide();
                  }
                },
              },
              {
                label: "Open current page in system browser",
                click: () => {
                  const current = browser.webContents.getURL();
                  if (allowedTcgNavigation(current))
                    void shell.openExternal(current);
                },
              },
              { type: "separator" },
              { role: "close" },
            ],
          },
        ]),
      );
    browser.webContents.on("will-navigate", (event, target) => {
      if (!allowedTcgNavigation(target)) event.preventDefault();
    });
    browser.webContents.on("will-redirect", (event, target) => {
      if (!allowedTcgNavigation(target)) event.preventDefault();
    });
    browser.webContents.setWindowOpenHandler(({ url: target }) => {
      if (allowedTcgNavigation(target))
        void browser.loadURL(target).catch(() => {});
      return { action: "deny" };
    });
    browser.webContents.on("did-navigate", menu);
    browser.webContents.on("did-navigate-in-page", menu);
    browser.on("closed", () => {
      this.window = null;
      void isolated.clearStorageData().catch(() => {});
    });
    menu();
    void browser.loadURL(url).catch(() => {});
  }
  close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
  }
}
