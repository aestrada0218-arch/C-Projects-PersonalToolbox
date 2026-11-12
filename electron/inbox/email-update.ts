import type { EmailUpdateEvent } from "../../src/inbox-types";
export function extractEmailUpdate(
  subject: string,
  text: string,
  received: string,
  externalId: string,
): EmailUpdateEvent | null {
  const original = text.slice(0, 120000).match(/^\s*Subject:\s*(.+)$/im)?.[1];
  const isRelevant = (s: string) =>
    /\b(?:shipped|shipment|shipping|delivery|delivered|tracking|dispatched|arriving|package|in transit|on (?:its|the) way)\b|\b(?:order\b.{0,70}\b(?:confirmed|confirmation|received)|(?:confirmed|confirmation)\b.{0,30}\border)\b/i.test(
      s,
    );
  const effective = isRelevant(subject)
    ? subject
    : original && isRelevant(original)
      ? original
      : null;
  if (!effective) return null;
  const clean = effective
    .replace(/^(?:(?:fwd?|re)\s*:\s*)+/gi, "")
    .replace(
      /\b(?:not|never|will be|to be|scheduled to be|expected to be)\s+delivered\b/gi,
      "",
    );
  let status: EmailUpdateEvent["status"] = "Needs review";
  if (/\b(?:delivered|delivery complete)\b/i.test(clean)) status = "Delivered";
  else if (/\bout for delivery\b/i.test(clean)) status = "Out for delivery";
  else if (
    /\b(?:shipped|dispatched|arriving|in transit|on (?:its|the) way)\b/i.test(
      clean,
    )
  )
    status = "In transit";
  else if (
    /\border\b.{0,70}\b(?:confirmed|confirmation|received)|\b(?:confirmed|confirmation)\b.{0,30}\border\b/i.test(
      clean,
    )
  )
    status = "Order confirmed";
  const orderReference =
    (effective + "\n" + text.slice(0, 120000)).match(
      /\border\s*(?:number|no\.?)?\s*[:#]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,39})\b/i,
    )?.[1] || null;
  return {
    externalId,
    subject: effective.slice(0, 200),
    received,
    status,
    orderReference,
  };
}
