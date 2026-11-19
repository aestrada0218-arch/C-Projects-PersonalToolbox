import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BackupInfo } from "../../src/organizer-types";
export class BackupManager {
  constructor(
    private directory: string,
    private livePath: string,
    private validate: (bytes: Uint8Array) => void,
  ) {}
  list(): BackupInfo[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((n) =>
        /^\d{4}-\d{2}-\d{2}T[\d-]+_[a-f0-9-]{36}_(daily|manual|restore-safety|import|pre-change)\.sqlite$/.test(
          n,
        ),
      )
      .map((id) => ({
        id,
        createdAt:
          id.slice(0, 19).replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3") +
          "Z",
        bytes: statSync(join(this.directory, id)).size,
        reason: id.match(
          /_(daily|manual|restore-safety|import|pre-change)\.sqlite$/,
        )![1],
      }))
      .sort((a, b) => b.id.localeCompare(a.id));
  }
  create(bytes: Uint8Array, reason: BackupInfo["reason"] = "manual") {
    this.validate(bytes);
    mkdirSync(this.directory, { recursive: true });
    const id =
      new Date().toISOString().slice(0, 19).replaceAll(":", "-") +
      "_" +
      randomUUID() +
      "_" +
      reason +
      ".sqlite";
    this.atomic(join(this.directory, id), bytes);
    if (reason === "daily")
      for (const old of this.list()
        .filter((b) => b.reason === "daily")
        .slice(30))
        unlinkSync(join(this.directory, old.id));
    return id;
  }
  daily(bytes: Uint8Array) {
    if (
      !this.list().some(
        (b) =>
          b.reason === "daily" &&
          b.createdAt.startsWith(new Date().toISOString().slice(0, 10)),
      )
    )
      this.create(bytes, "daily");
  }
  bytes(id: string) {
    if (!this.list().some((b) => b.id === id))
      throw Error("Choose a saved backup.");
    const path = join(this.directory, id);
    if (statSync(path).size > 128 * 1024 * 1024)
      throw Error("Backup exceeds 128 MiB.");
    const bytes = readFileSync(path);
    this.validate(bytes);
    return bytes;
  }
  queueRestore(id: string) {
    this.bytes(id);
    this.atomic(this.livePath + ".restore-request", Buffer.from(id));
  }
  applyPending() {
    const request = this.livePath + ".restore-request",
      applying = this.livePath + ".restore-applying";
    if (!existsSync(request)) return;
    try {
      const id = readFileSync(request, "utf8"),
        bytes = this.bytes(id);
      if (existsSync(this.livePath))
        this.create(readFileSync(this.livePath), "restore-safety");
      renameSync(request, applying);
      this.atomic(this.livePath, bytes);
    } finally {
      for (const file of [request, applying])
        try {
          if (existsSync(file)) unlinkSync(file);
        } catch {
          /* A leftover applying marker is never replayed. */
        }
    }
  }
  private atomic(path: string, bytes: Uint8Array) {
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(tmp, bytes, { mode: 0o600, flag: "wx" });
      renameSync(tmp, path);
    } finally {
      if (existsSync(tmp)) unlinkSync(tmp);
    }
  }
}
