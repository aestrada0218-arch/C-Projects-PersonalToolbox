import type { OrganizerKind } from "./organizer-types";
export type Field = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  optional?: boolean;
};
const f = (
  key: string,
  label: string,
  type = "text",
  optional = false,
): Field => ({ key, label, type, optional });
const select = (key: string, label: string, options: string[]): Field => ({
  key,
  label,
  type: "select",
  options,
});
export const fields: Record<OrganizerKind, Field[]> = {
  line: [
    f("orderId", "Order", "order"),
    f("description", "Description"),
    f("quantity", "Quantity ordered", "quantity"),
    f("unitCents", "Unit purchase price ($)", "money"),
  ],
  receipt: [
    f("lineId", "Order line", "line"),
    f("packageId", "Package", "package", true),
    f("quantity", "Quantity received", "quantity"),
    f("date", "Received date", "date"),
  ],
  package: [
    f("orderId", "Order", "order"),
    select("carrier", "Carrier", ["UPS", "USPS", "FedEx", "DHL", "Other"]),
    f("tracking", "Tracking number", "text", true),
    select("status", "Package status", [
      "Awaiting shipment",
      "In transit",
      "Delivered",
      "Exception",
    ]),
    f("expectedDate", "Expected arrival", "date", true),
    f("actualDate", "Actual arrival", "date", true),
    f("notes", "Notes", "textarea", true),
  ],
  return: [
    f("orderId", "Order", "order"),
    f("reason", "Reason"),
    f("deadline", "Return deadline", "date", true),
    f("expectedCents", "Expected refund ($)", "money"),
    f("refundedCents", "Refund received ($)", "money"),
    select("status", "Return status", [
      "Requested",
      "Returning",
      "Refund pending",
      "Refunded",
      "Cancelled",
    ]),
    f("notes", "Notes", "textarea", true),
  ],
  details: [
    f("collectionId", "Collection item", "collection"),
    f("series", "Series", "text", true),
    f("issue", "Issue number", "text", true),
    f("coverArtist", "Cover artist", "text", true),
    f("variant", "Cover / variant", "text", true),
    f("printing", "Printing", "text", true),
    f("condition", "Condition", "text", true),
    f("grade", "Grade / grading company", "text", true),
    f("certification", "Certification number", "text", true),
    f("location", "Storage location", "text", true),
    f("notes", "Notes", "textarea", true),
  ],
  wishlist: [
    f("name", "Wanted item"),
    select("section", "Collection section", ["cards", "comics", "other"]),
    f("category", "Category", "text", true),
    f("maxPriceCents", "Target maximum price ($)", "money", true),
    f("referenceUrl", "Reference URL", "url", true),
    f("notes", "Notes", "textarea", true),
  ],
  sale: [
    f("collectionId", "Collection item", "collection"),
    f("quantity", "Quantity sold", "quantity"),
    f("date", "Sale date", "date"),
    f("marketplace", "Marketplace"),
    f("reference", "Sale / order reference", "text", true),
    f("grossCents", "Gross sale including shipping/tax ($)", "money"),
    f("purchaseShippingCents", "Allocated purchase shipping ($)", "money"),
    f("purchaseTaxCents", "Allocated purchase tax ($)", "money"),
    f("feesCents", "Marketplace fees ($)", "money"),
    f("postageCents", "Outgoing postage ($)", "money"),
    f("salesTaxCents", "Tax withheld / remitted ($)", "money"),
    f("refundCents", "Buyer refund ($)", "money"),
    f("payoutCents", "Actual payout received ($)", "money", true),
    f("notes", "Notes", "textarea", true),
  ],
  budget: [
    select("category", "Budget category", [
      "All expenses",
      "Proxy Providers",
      "Cook Groups",
      "Shipping Costs",
      "My Collection",
      "Other Expenses",
    ]),
    f("amountCents", "Monthly budget ($)", "money"),
  ],
  reminder: [
    f("title", "Reminder"),
    f("date", "Due date", "date"),
    f("completed", "Completed", "checkbox"),
    f("notes", "Notes", "textarea", true),
  ],
  attachment: [
    select("targetType", "Attach to", ["collection", "order"]),
    f("targetId", "Item / order", "target"),
    f("name", "Attachment name"),
    f("data", "Photo or PDF receipt", "file"),
  ],
};
export const kindLabels: Record<OrganizerKind, string> = {
  line: "Order line",
  receipt: "Receiving record",
  package: "Package",
  return: "Return / refund",
  details: "Comic details / location",
  wishlist: "Wishlist item",
  sale: "Sale / item profit",
  budget: "Monthly budget",
  reminder: "Reminder",
  attachment: "Photo / receipt",
};
export const sections = {
  Overview: [],
  Tracking: [],
  Orders: ["line", "receipt", "package", "return"],
  Collection: ["details", "attachment"],
  Wishlist: ["wishlist"],
  Finances: ["sale"],
  Budgets: ["budget"],
  Reminders: ["reminder"],
  History: [],
  Backups: [],
} as const;
export type OrganizerSection = keyof typeof sections;
