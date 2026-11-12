import type { CatalogCard } from "./collection-types";

/** Images are addressed only by catalog product IDs, never by arbitrary URLs. */
export function tcgArtworkUrl(productId: string | null | undefined) {
  return typeof productId === "string" && /^[1-9]\d{0,11}$/.test(productId)
    ? `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_400x400.jpg`
    : null;
}

/** The pricing API searches card names rather than full marketplace titles. */
export function catalogNameQuery(title: string) {
  const value = title.trim();
  if (/^https?:/i.test(value)) return value;
  const parts = value.split(/\s+[-–—]\s+/);
  // Preserve names like Ho-Oh and normal multiword names. Only interpret the
  // spaced separators used in a name / variant / set marketplace title.
  if (
    parts.length >= 3 ||
    (parts.length === 2 && /\([A-Za-z0-9-]{2,12}\)\s*$/.test(parts[1]))
  ) {
    const name = parts[0].trim();
    if (name.length >= 2) return name;
  }
  return value;
}

/** Rank a pasted title's exact card/set first within this provider page. */
export function rankCatalogCards(cards: CatalogCard[], title: string) {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  const query = catalogNameQuery(title);
  if (query === title.trim()) return cards;
  const full = clean(title);
  const score = (card: CatalogCard) =>
    (full.startsWith(clean(card.name)) ? clean(card.name).length : 0) +
    (clean(card.setName).length > 3 && full.includes(clean(card.setName))
      ? 1000
      : 0);
  return [...cards].sort((a, b) => score(b) - score(a));
}
