import type { ParsedMail } from "mailparser";
import type { Receipt } from "../../src/mailbox-types";
import { saleEmailText } from "../shipping/email-text";
export function parseMinkysReceipt(mail: ParsedMail): Receipt | null {
  if (
    !mail.from?.value.some(
      (v) => v.address?.toLowerCase() === "service@paypal.com",
    )
  )
    return null;
  if (
    /\b(?:refund|refunded|cancelled|canceled|reversal)\b/i.test(
      mail.subject || "",
    )
  )
    return null;
  const text = saleEmailText(mail)
    .replace(/\u00a0/g, " ")
    .replace(/[’‘]/g, "'");
  const payee = text.match(
    /\bPayment to\b([\s\S]{0,500}?)(?:\bTransaction ID\b|\bNote to payment recipient\b|\bPayment from\b|\bDate\b)/i,
  )?.[1];
  if (
    !payee ||
    !(
      /\bminky'?s\s+designs\b/i.test(payee) &&
      /\bminkysdesigns@gmail\.com\b/i.test(payee)
    )
  )
    return null;
  if (!/Payment Status\s+COMPLETED\b/i.test(text)) return null;
  const transactionId = text
    .match(/Transaction ID\s+([A-Z0-9]{10,30})\b/i)?.[1]
    ?.toUpperCase();
  const dateText = text.match(/\bDate\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)?.[1];
  if (!transactionId || !dateText) return null;
  const date = new Date(dateText + " 12:00:00 GMT");
  if (!Number.isFinite(date.getTime())) return null;
  const purchaseDate = date.toISOString().slice(0, 10);
  const body = text
    .split(/Description\s+Unit price\s+Qty\s+Amount/i)[1]
    ?.split(
      /Shipping and handling|Sales Tax|Transaction Summary|\bSubtotal\b|\bTotal\b|\bDiscount\b/i,
    )[0];
  if (!body) return null;
  const money = "\\$([\\d,]+\\.\\d{2})\\s*(?:USD)?";
  const pattern = new RegExp(
    "([\\s\\S]+?)\\s+" + money + "\\s+(\\d+)\\s+" + money,
    "gi",
  );
  const lines: Receipt["lines"] = [];
  let end = 0;
  for (const m of body.matchAll(pattern)) {
    const description = m[1].replace(/\s+/g, " ").trim(),
      unitCents = Math.round(Number(m[2].replace(/,/g, "")) * 100),
      quantity = Number(m[3]),
      amountCents = Math.round(Number(m[4].replace(/,/g, "")) * 100);
    if (
      !description ||
      description.length > 200 ||
      quantity < 1 ||
      quantity > 100000 ||
      unitCents > 1e9 ||
      amountCents > 1e9 ||
      unitCents * quantity !== amountCents
    )
      return null;
    lines.push({
      description,
      unitCents,
      quantity,
      amountCents,
      kind: /\b(?:shipping|postage|freight)\b/i.test(description)
        ? "shipping"
        : "item",
    });
    end = m.index! + m[0].length;
  }
  if (!lines.length || lines.length > 200 || body.slice(end).trim())
    return null;
  return { transactionId, purchaseDate, lines };
}
