import { dialog, type BrowserWindow } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { EntryService } from "./service";
import type { EntryRepository } from "./store";
import { sampleEntryCsv } from "./csv";
export function registerEntryHandlers(
  service: EntryService,
  repo: EntryRepository,
  window: () => BrowserWindow,
  handle: (name: string, fn: (...args: any[]) => unknown) => void,
) {
  handle("toolbox:entry-state", () => service.state());
  handle("toolbox:entry-campaign-create", (input) =>
    service.local(() => repo.createCampaign(input)),
  );
  handle("toolbox:entry-campaign-edit", (input) =>
    service.local(() => repo.editCampaign(input)),
  );
  handle("toolbox:entry-profile", (id) => repo.profile(id));
  handle("toolbox:entry-profile-edit", (input) =>
    service.local(() => repo.editProfile(input)),
  );
  handle("toolbox:entry-job-delete", (id) =>
    service.local(() => repo.removeJob(id)),
  );
  handle("toolbox:entry-job-retry", (input) =>
    service.local(() => repo.retry(input)),
  );
  handle("toolbox:entry-import-preview", async (input) => {
    const campaignId = z.string().uuid().parse(input);
    repo.campaign(campaignId);
    const file = await dialog.showOpenDialog(window(), {
      title: "Import authorized family profiles",
      properties: ["openFile"],
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (file.canceled || !file.filePaths[0]) return { cancelled: true };
    try {
      const path = file.filePaths[0];
      if ((await stat(path)).size > 2 * 1024 * 1024)
        return { error: "CSV is limited to 2 MiB." };
      const bytes = await readFile(path);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return service.preview(campaignId, text);
    } catch {
      return {
        error: "Could not read the CSV. Use UTF-8 and a readable local file.",
      };
    }
  });
  handle("toolbox:entry-import-commit", (token) => service.commit(token));
  handle("toolbox:entry-sample", async () => {
    const file = await dialog.showSaveDialog(window(), {
      title: "Save entry profile CSV template",
      defaultPath: "entry-profiles-template.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (file.canceled || !file.filePath) return false;
    await writeFile(file.filePath, sampleEntryCsv, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  });
  handle("toolbox:entry-proxy-save", (input) => service.saveProxy(input));
  handle("toolbox:entry-proxy-delete", (id) => service.removeProxy(id));
  handle("toolbox:entry-proxy-test", (id) => service.testProxy(id));
  handle("toolbox:entry-gmail-connect", (input) => service.connectGmail(input));
  handle("toolbox:entry-gmail-disconnect", () => service.disconnectGmail());
  handle("toolbox:entry-start", (input) => service.start(input));
  handle("toolbox:entry-answer", (input) => service.answer(input));
  handle("toolbox:entry-focus", (id) => service.focus(id));
  handle("toolbox:entry-pause", () => service.pause());
  handle("toolbox:entry-resume", () => service.resume());
  handle("toolbox:entry-stop", () => service.stop());
}
