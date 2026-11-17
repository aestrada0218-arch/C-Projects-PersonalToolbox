import { parseCsv } from "../expenses/csv";
import { profileSchema, identity, maskEmail } from "./model";
import type { EntryProfile, EntryProxy } from "../../src/entry-types";
export type ImportedEntry = {
  profile: EntryProfile;
  proxyId: string | null;
  number: number;
};
export function parseEntryCsv(
  text: string,
  proxies: EntryProxy[] = [],
): ImportedEntry[] {
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024)
    throw Error("CSV is limited to 2 MiB.");
  const rows = parseCsv(text);
  if (rows.length < 2)
    throw Error("CSV needs a header and at least one profile.");
  if (rows.length > 501) throw Error("Import at most 500 profiles at a time.");
  const required = [
      "email",
      "first_name",
      "last_name",
      "address",
      "city",
      "state",
      "zip",
    ],
    headers = rows.shift()!.map((v) => v.trim().toLowerCase());
  if (new Set(headers).size !== headers.length)
    throw Error("CSV contains duplicate headers.");
  if (
    required.some((h) => !headers.includes(h)) ||
    headers.some((h) => ![...required, "label", "proxy_name"].includes(h))
  )
    throw Error(
      "Use email, first_name, last_name, address, city, state, zip; optional label and proxy_name.",
    );
  return rows.map((row, index) => {
    if (row.length !== headers.length)
      throw Error(`Row ${index + 2}: column count does not match the header.`);
    const value = Object.fromEntries(headers.map((h, i) => [h, row[i]])),
      parsed = profileSchema.safeParse(
        Object.fromEntries(
          [...required, "label"].map((k) => [k, value[k] || ""]),
        ),
      );
    if (!parsed.success)
      throw Error(
        `Row ${index + 2}: check ${[...new Set(parsed.error.issues.map((i) => i.path[0]))].join(", ")}.`,
      );
    let proxyId: string | null = null;
    if (value.proxy_name?.trim()) {
      const proxy = proxies.find((p) => p.name === value.proxy_name.trim());
      if (!proxy)
        throw Error(
          `Row ${index + 2}: proxy_name does not match a saved proxy.`,
        );
      proxyId = proxy.id;
    }
    return { profile: parsed.data, proxyId, number: index + 2 };
  });
}
export function previewRows(rows: ImportedEntry[], proxies: EntryProxy[]) {
  return rows.slice(0, 10).map((row) => ({
    number: row.number,
    label:
      row.profile.label || `${row.profile.first_name} ${row.profile.last_name}`,
    maskedEmail: maskEmail(row.profile.email),
    proxyName:
      proxies.find((p) => p.id === row.proxyId)?.name || "Direct connection",
  }));
}
export const sampleEntryCsv =
  "email,first_name,last_name,address,city,state,zip,label,proxy_name\r\nfamily@example.com,Example,Person,123 Example Street,Chicago,IL,60601,Family profile 1,\r\n";
