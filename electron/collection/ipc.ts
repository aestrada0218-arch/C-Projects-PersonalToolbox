import { safePhotoSize } from "./photo";
import { dialog, nativeImage, shell, type BrowserWindow } from "electron";
import { readFile, stat } from "node:fs/promises";
import type { CollectionService } from "./service";
import type { CollectionRepository } from "./store";
import type { TcgCatalogBrowser } from "./browser";
import { allowedTcgNavigation } from "./model";
export function registerCollectionHandlers(
  service: CollectionService,
  repo: CollectionRepository,
  browser: TcgCatalogBrowser,
  window: () => BrowserWindow,
  handle: (channel: string, fn: (...args: any[]) => unknown) => void,
) {
  handle("toolbox:collection-state", () => service.state());
  handle("toolbox:collection-connect", (input) => service.connect(input));
  handle("toolbox:collection-disconnect", () => service.disconnect());
  handle("toolbox:collection-search", (input) => service.search(input));
  handle("toolbox:collection-add-linked", (input) => service.addLinked(input));
  handle("toolbox:collection-add-manual", (input) => service.manual(input));
  handle("toolbox:collection-edit", (input) => service.edit(input));
  handle("toolbox:collection-delete", (id) => service.remove(id));
  handle("toolbox:collection-refresh", (id) => service.refresh(id));
  handle("toolbox:collection-history", (id) => repo.history(id));
  handle("toolbox:collection-browser", () => {
    browser.open();
    return browser.state();
  });
  handle("toolbox:collection-browser-state", () => browser.state());
  handle("toolbox:collection-external", async (input) => {
    const url = typeof input === "string" ? input : "";
    if (
      !allowedTcgNavigation(url) &&
      ![
        "https://justtcg.com/",
        "https://justtcg.com/dashboard",
        "https://justtcg.com/pricing",
      ].includes(url)
    )
      throw Error("Invalid provider URL");
    await shell.openExternal(url);
    return true;
  });
  handle("toolbox:collection-image", async () => {
    const file = await dialog.showOpenDialog(window(), {
      title: "Choose your collection photo",
      properties: ["openFile"],
      filters: [
        { name: "PNG or JPEG image", extensions: ["png", "jpg", "jpeg"] },
      ],
    });
    if (file.canceled || !file.filePaths[0]) return { data: null };
    try {
      const path = file.filePaths[0];
      if ((await stat(path)).size > 5 * 1024 * 1024)
        return { data: null, error: "Choose an image no larger than 5 MiB." };
      const bytes = await readFile(path);
      const dimensions = safePhotoSize(bytes);
      if (!dimensions)
        return {
          data: null,
          error: "Use a PNG/JPEG image up to 4096 × 4096 pixels.",
        };
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty())
        return { data: null, error: "This image could not be opened." };
      const scale = Math.min(
        1,
        256 / dimensions.width,
        256 / dimensions.height,
      );
      const data = image
        .resize({
          width: Math.max(1, Math.round(dimensions.width * scale)),
          height: Math.max(1, Math.round(dimensions.height * scale)),
        })
        .toDataURL();
      if (data.length > 500000)
        return { data: null, error: "This image is too large after resizing." };
      return { data };
    } catch {
      return { data: null, error: "Could not read the selected image." };
    }
  });
}
