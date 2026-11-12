import type { SaleEmailEvent } from "../../src/shipping-types";
import { shippingDate } from "./model";
const ebaySender = (value: string) => {
  const address = value.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return (
    address.includes("@") &&
    (domain === "ebay.com" || domain.endsWith(".ebay.com"))
  );
};
function calendar(year: number, month: number, day: number) {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return shippingDate.safeParse(value).success ? value : null;
}
export function extractShipBy(text: string): string | null {
  // Date labels are explicit. Never infer a deadline from handling time or an
  // unrelated date, and never reinterpret a date-only deadline through UTC.
  const label = text
    .match(/\bship\s+by\s*:?\s*([^\n]*(?:\n[^\n]*)?)/i)?.[1]
    ?.trim()
    .slice(0, 100);
  if (!label) return null;
  const value = label.replace(
    /^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)[,\s]+/i,
    "",
  );
  let m = value.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return calendar(+m[1], +m[2], +m[3]);
  m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return calendar(+m[3], +m[1], +m[2]);
  m = value.match(
    /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i,
  );
  if (!m) return null;
  if (
    !/^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)$/i.test(
      m[1],
    )
  )
    return null;
  const month =
    [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ].indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  return month ? calendar(+m[3], month, +m[2]) : null;
}
export function extractEbaySale(input: {
  subject: string;
  text: string;
  senders: string[];
  received: string;
  externalId: string;
}): SaleEmailEvent | null {
  let subject = input.subject.replace(/^(?:(?:fwd?|re)\s*:\s*)+/gi, "").trim();
  let text = input.text.slice(0, 120000).replace(/\r\n?/g, "\n");
  // A reply/cancellation must not turn its quoted original sale into a task.
  if (
    /\b(?:cancel(?:led|ed|lation)?|refund(?:ed)?|return request|payment reminder)\b/i.test(
      subject,
    )
  )
    return null;
  let trustedSender = input.senders.some(ebaySender);
  if (
    !trustedSender &&
    /(?:Forwarded message|Begin forwarded message)/i.test(text)
  ) {
    const block = text.slice(
      text.search(/(?:Forwarded message|Begin forwarded message)/i),
    );
    const from = block
      .slice(0, 5000)
      .match(
        /^\s*From:\s*[^\n]*?([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/im,
      )?.[1];
    trustedSender = Boolean(from && ebaySender(from));
    if (trustedSender) {
      subject =
        block
          .slice(0, 5000)
          .match(/^\s*Subject:\s*(.+)$/im)?.[1]
          ?.trim() || subject;
      text = block;
    }
  }
  if (
    !trustedSender ||
    /\b(?:cancel(?:led|ed|lation)?|refund(?:ed)?)\b/i.test(subject)
  )
    return null;
  text = text.split(/\nOn [^\n]{1,200}wrote:\s*\n/i)[0];
  const sellerSubject =
    /\b(?:you made (?:the|a) sale|you sold|your item (?:has )?sold|sale confirmed)\b/i.test(
      subject,
    );
  const sellerBody =
    /\b(?:your (?:item|items) (?:has|have) sold|your buyer has paid)\b/i.test(
      text,
    );
  if (!sellerSubject && !sellerBody) return null;
  // Buyer receipts alone and marketing about selling are not seller notices.
  if (
    !sellerSubject &&
    /\b(?:your order|thanks for (?:your )?(?:order|purchase)|you bought)\b/i.test(
      subject,
    )
  )
    return null;
  const name =
    subject.match(
      /^(?:you made (?:the|a) sale\s+(?:for|of)|you sold\s*:?)\s+(.+)$/i,
    )?.[1] ||
    text.match(/^\s*(?:item (?:name|sold)|item title)\s*:\s*(.+)$/im)?.[1] ||
    "eBay sale — review item details";
  const orderReference =
    (subject + "\n" + text).match(
      /\border\s*(?:number|no\.?|#)?\s*[:#]?\s*(\d{2}-\d{5}-\d{5})\b/i,
    )?.[1] || null;
  const awaiting =
    /\b(?:not (?:yet )?paid|hasn['’]t paid|awaiting payment|waiting for (?:the )?(?:buyer['’]s )?payment|payment (?:is )?pending)\b/i.test(
      text + "\n" + subject,
    );
  const paid =
    /\b(?:your buyer has paid|payment (?:has been )?received|paid[ \t]*:[ \t]*yes)\b/i.test(
      text,
    ) || /\byour buyer has paid\b/i.test(subject);
  return {
    externalId: input.externalId,
    name: name.trim().slice(0, 240),
    orderReference,
    shipBy: extractShipBy(text),
    paymentStatus: awaiting
      ? "Awaiting payment"
      : paid
        ? "Paid"
        : "Needs review",
    subject: subject.slice(0, 200),
    received: input.received,
  };
}
