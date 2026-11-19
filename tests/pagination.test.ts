import { it, expect } from "vitest";
import { paginate } from "../src/pagination";
import { collectibleReference } from "../electron/collection/model";
it("paginates the complete filtered dataset, supports both sizes and clamps after deletion", () => {
  const rows = Array.from({ length: 231 }, (_, id) => ({
    id,
    name: `Item ${id}`,
  }));
  expect(paginate(rows, 1, 25)).toMatchObject({
    first: 1,
    last: 25,
    total: 231,
    pages: 10,
  });
  expect(paginate(rows, 2, 50).visible[0].id).toBe(50);
  expect(
    paginate(
      rows.filter((r) => r.name === "Item 230"),
      10,
      25,
    ),
  ).toMatchObject({
    current: 1,
    total: 1,
    visible: [{ id: 230, name: "Item 230" }],
  });
  expect(paginate([], 8, 50)).toMatchObject({
    first: 0,
    last: 0,
    current: 1,
    pages: 1,
  });
  expect(paginate(rows.slice(0, 26), 10, 25)).toMatchObject({
    current: 2,
    first: 26,
    last: 26,
  });
});
it("resolves HTTPS reference links only from saved items and rejects unsafe or missing links", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  expect(
    collectibleReference(
      [{ id, referenceUrl: "https://example.org/comics/1?q=test#details" }],
      id,
    ),
  ).toBe("https://example.org/comics/1?q=test#details");
  for (const referenceUrl of [
    null,
    "javascript:alert(1)",
    "file:///private",
    "http://example.org/",
    "https://user:password@example.org/",
  ])
    expect(() => collectibleReference([{ id, referenceUrl }], id)).toThrow();
  expect(() => collectibleReference([], id)).toThrow();
  expect(() => collectibleReference([], "https://example.org/")).toThrow();
});
