import type { ShipmentEvent, ShipmentStatus } from "../../src/inbox-types";
export function extractShipments(
  subject: string,
  text: string,
  received: string,
): ShipmentEvent[] {
  const content = (subject + "\n" + text).slice(0, 120000);
  if (
    !/\b(track(?:ing)?|shipment|shipped|dispatched|arriving|package|delivery|delivered)\b/i.test(
      content,
    )
  )
    return [];
  const clean = subject.replace(
    /\b(?:not|never|will be|to be|scheduled to be|expected to be)\s+delivered\b/gi,
    "",
  );
  let status: ShipmentStatus = "In transit";
  if (
    /\b(?:has been delivered|was delivered|delivered|delivery complete)\b/i.test(
      clean,
    )
  )
    status = "Delivered";
  else if (/\bout for delivery\b/i.test(clean)) status = "Out for delivery";
  // Only an explicit status in the subject changes an order. Bodies often quote old events.
  else if (
    !/\b(shipped|dispatched|arriving|shipping confirmation|in transit|on (?:its|the) way|tracking|shipment|package)\b/i.test(
      subject,
    )
  )
    return [];
  const numbers = new Map<string, string>();
  const collect = (re: RegExp, carrier: string, index = 0) => {
    for (const m of content.matchAll(re)) {
      const n = m[index].replace(/[ -]/g, "").toUpperCase();
      numbers.set(n, carrier);
    }
  };
  collect(/\b1Z[A-Z0-9]{16}\b/gi, "UPS");
  collect(/\b9[2345]\d{18,20}\b/g, "USPS");
  collect(/\bTBA\d{12,16}\b/gi, "Amazon");
  collect(
    /\bFedEx\s*(?:tracking\s*(?:number|no\.?|#)?\s*[:#-]?\s*)?(\d{12}|\d{15})\b/gi,
    "FedEx",
    1,
  );
  collect(
    /\bDHL\s*(?:tracking\s*(?:number|no\.?|#)?\s*[:#-]?\s*)?(\d{10})\b/gi,
    "DHL",
    1,
  );
  if (/\bFedEx\b/i.test(content))
    collect(
      /\btracking\s*(?:number|no\.?|#)?\s*[:#-]?\s*(\d{12}|\d{15})\b/gi,
      "FedEx",
      1,
    );
  if (/\bDHL\b/i.test(content))
    collect(
      /\btracking\s*(?:number|no\.?|#)?\s*[:#-]?\s*(\d{10})\b/gi,
      "DHL",
      1,
    );
  for (const match of content.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    try {
      const url = new URL(match[0]);
      const host = url.hostname.toLowerCase();
      if (host === "fedex.com" || host.endsWith(".fedex.com")) {
        const value = url.searchParams.get("trknbr");
        if (value && /^(?:\d{12}|\d{15})$/.test(value))
          numbers.set(value, "FedEx");
      }
      if (host === "dhl.com" || host.endsWith(".dhl.com")) {
        const value = url.searchParams.get("tracking-id");
        if (value && /^\d{10}$/.test(value)) numbers.set(value, "DHL");
      }
    } catch {}
  }
  return [...numbers].slice(0, 10).map(([tracking, carrier]) => ({
    tracking,
    carrier,
    status,
    received,
    subject: subject.slice(0, 200),
  }));
}
