import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export const companionOrigin = z
  .string()
  .url()
  .max(253)
  .transform((v) => {
    const u = new URL(v);
    if (
      u.protocol !== "https:" ||
      !u.hostname.endsWith(".ts.net") ||
      u.port ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      throw Error("ORIGIN_INVALID");
    return u.origin;
  });
const rememberedDevice = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(64),
    lastSeen: z.string().datetime(),
    expiresAt: z.string().datetime(),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const preferencesSchema = z
  .object({
    version: z.literal(1),
    url: companionOrigin.nullable(),
    enabled: z.boolean(),
    devices: z.array(rememberedDevice).max(20),
  })
  .strict()
  .refine((v) => !v.enabled || v.url !== null);
export type CompanionPreferences = z.infer<typeof preferencesSchema>;
export interface CompanionPersistence {
  load(): CompanionPreferences | null;
  save(value: CompanionPreferences): void;
}
// Contains token hashes only, never a bearer token, CSRF secret or pairing code.
// Atomic replacement prevents partially written settings from granting access.
export class FileCompanionPreferences implements CompanionPersistence {
  constructor(private path: string) {}
  load() {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    if (Buffer.byteLength(raw) > 65536) throw Error("PREFERENCES_INVALID");
    return preferencesSchema.parse(JSON.parse(raw));
  }
  save(value: CompanionPreferences) {
    const validated = preferencesSchema.parse(value);
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = this.path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temp, JSON.stringify(validated), {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temp, this.path);
    } finally {
      try {
        unlinkSync(temp);
      } catch {
        /* already renamed */
      }
    }
  }
}
