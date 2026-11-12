import { convert } from "html-to-text";
/** Convert to text without loading message resources. Preserve cell boundaries
 * so a buyer address column cannot run into a ship-by date column. */
export function saleEmailText(mail: { text?: string; html?: string | false }) {
  if (!mail.html) return mail.text || "";
  return convert(mail.html, {
    wordwrap: false,
    limits: { maxInputLength: 1024 * 1024, maxDepth: 40 },
    selectors: [
      {
        selector: "td",
        format: "block",
        options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
      },
      {
        selector: "th",
        format: "block",
        options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
      },
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
    ],
  });
}
