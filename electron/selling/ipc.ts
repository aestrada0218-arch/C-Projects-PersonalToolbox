import {
  clipboard,
  dialog,
  nativeImage,
  shell,
  type BrowserWindow,
} from "electron";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { safePhotoSize } from "../collection/photo";
import { listingUrl } from "./model";
import type { SellingRepository } from "./store";
import type { SellingService } from "./service";
export function registerSellingHandlers(
  service: SellingService,
  repo: SellingRepository,
  window: () => BrowserWindow,
  handle: (channel: string, fn: (...args: any[]) => unknown) => void,
) {
  handle("toolbox:selling-state", () => service.state());
  handle("toolbox:selling-category", (id) => service.category(id));
  handle("toolbox:selling-connect", (input) => service.connect(input));
  handle("toolbox:selling-disconnect", () => service.disconnect());
  handle("toolbox:selling-create", (input) =>
    service.local(() => repo.create(input)),
  );
  handle("toolbox:selling-edit", (input) =>
    service.local(() => repo.edit(input)),
  );
  handle("toolbox:selling-delete", (id) =>
    service.local(() => repo.remove(id)),
  );
  handle("toolbox:selling-options", () => service.refreshOptions());
  handle("toolbox:selling-location", (input) => service.createLocation(input));
  handle("toolbox:selling-prepare", (id) => service.prepare(id));
  handle("toolbox:selling-publish", (input) => service.publish(input));
  handle("toolbox:selling-reconcile", (id) => service.reconcile(id));
  handle("toolbox:selling-end", (id) => service.end(id));
  handle("toolbox:selling-link-mercari", (input) =>
    service.local(() => repo.linkMercari(input)),
  );
  handle("toolbox:selling-inactive-mercari", (input) =>
    service.local(() => repo.inactiveMercari(input)),
  );
  handle("toolbox:selling-sale-mercari", (input) => service.mercariSale(input));
  handle("toolbox:selling-conflict", (id) =>
    service.local(() => repo.reviewConflict(id)),
  );
  handle("toolbox:selling-auto", (value) =>
    service.local(() => repo.automatic(value)),
  );
  handle("toolbox:selling-sync", () => service.sync());
  handle("toolbox:selling-open", async (input) => {
    const value = z
        .object({
          id: z.string().uuid(),
          platform: z.enum(["ebay", "mercari"]),
        })
        .strict()
        .parse(input),
      unit = repo.get(value.id);
    const id = value.platform === "ebay" ? unit.ebayListingId : unit.mercariId;
    if (!id) throw Error("Missing listing");
    await shell.openExternal(
      listingUrl(value.platform, id, unit.environment || "production"),
    );
    return true;
  });
  handle("toolbox:selling-help", async (input) => {
    const page = z.enum(["ebay", "mercari"]).parse(input);
    await shell.openExternal(
      page === "ebay"
        ? "https://developer.ebay.com/my/keys"
        : "https://www.mercari.com/sell/",
    );
    return true;
  });
  handle("toolbox:selling-copy", (input) => {
    const { id, field } = z
        .object({
          id: z.string().uuid(),
          field: z.enum(["title", "description", "all"]),
        })
        .strict()
        .parse(input),
      unit = repo.get(id);
    clipboard.writeText(
      field === "title"
        ? unit.title
        : field === "description"
          ? unit.description
          : `${unit.title}\n\n${unit.description}\n\nPrice: $${(unit.priceCents / 100).toFixed(2)} USD\nQuantity: 1\nCopy identifier: ${unit.unitLabel}\nSKU: ${unit.sku}`,
    );
    return true;
  });
  handle("toolbox:selling-photo", async (input) => {
    const id = z.string().uuid().parse(input),
      unit = repo.get(id);
    if (unit.soldOn || !["draft", "prepared"].includes(unit.ebayState))
      throw Error("Locked listing");
    const file = await dialog.showOpenDialog(window(), {
      title: "Upload your item photo to eBay",
      properties: ["openFile"],
      filters: [{ name: "JPEG or PNG", extensions: ["jpg", "jpeg", "png"] }],
    });
    if (file.canceled || !file.filePaths[0])
      return { ok: true, state: service.state() };
    try {
      const path = file.filePaths[0];
      if ((await stat(path)).size > 10 * 1024 * 1024)
        throw Error("Photo too large");
      const bytes = await readFile(path),
        size = safePhotoSize(bytes);
      if (!size || Math.max(size.width, size.height) < 500)
        throw Error("Photo dimensions");
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw Error("Invalid photo");
      const scale = Math.min(1, 1600 / Math.max(size.width, size.height)),
        sanitized = image
          .resize({
            width: Math.round(size.width * scale),
            height: Math.round(size.height * scale),
          })
          .toJPEG(90);
      return service.upload(id, sanitized);
    } catch {
      return {
        ok: false,
        state: service.state(),
        error:
          "Choose a JPEG/PNG under 10 MiB, up to 4096 × 4096 pixels, with its longest side at least 500 pixels.",
      };
    }
  });
}
