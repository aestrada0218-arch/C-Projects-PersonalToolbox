import { it, expect } from "vitest";
import { extractEmailUpdate } from "../electron/inbox/email-update";
import { extractShipments } from "../electron/inbox/extract";
import { Store } from "../electron/database";
const received = "2026-11-12T12:00:00.000Z";
it("recognizes forwarded confirmations and Amazon delivery updates without inventing tracking", () => {
  const confirmation = extractEmailUpdate(
    "Fwd: Order #98765432 confirmed",
    "---------- Forwarded message ---------\nFrom: Example store\nSubject: Order #98765432 confirmed\nOrder #98765432",
    received,
    "message-confirmation",
  );
  expect(confirmation).toMatchObject({
    status: "Order confirmed",
    orderReference: "98765432",
  });
  const subject = "Fwd: Out for delivery 1 item: Example item";
  const delivery = extractEmailUpdate(
    subject,
    "---------- Forwarded message ---------\nFrom: Amazon.com\nSubject: Out for delivery 1 item: Example item",
    received,
    "message-delivery",
  );
  expect(delivery?.status).toBe("Out for delivery");
  expect(
    extractShipments(subject, "No visible tracking number", received),
  ).toEqual([]);
});
it("reads an original forwarded subject but ignores quoted delivered history and unrelated forwards", () => {
  expect(
    extractEmailUpdate(
      "Fwd: FYI",
      "Subject: Order #98765432 confirmed\nOld note: delivered",
      received,
      "a",
    )?.status,
  ).toBe("Order confirmed");
  expect(
    extractEmailUpdate(
      "Fwd: Your package will be delivered tomorrow",
      "",
      received,
      "b",
    )?.status,
  ).not.toBe("Delivered");
  expect(
    extractEmailUpdate("Fwd: Lunch plans", "See you tomorrow", received, "c"),
  ).toBeNull();
});
it("deduplicates untracked updates, applies only explicit order links, prevents regressions, and retains imported history on disconnect", async () => {
  const db = await Store.open();
  try {
    const update = extractEmailUpdate(
      "Fwd: Order #98765432 confirmed",
      "",
      received,
      "mail-1",
    )!;
    const scan = {
      events: [],
      updates: [update],
      scanned: 1,
      skipped: 0,
      limited: false,
    };
    db.connectInbox("test@gmail.com", scan);
    db.recordInboxScan(scan);
    expect(db.emailUpdates()).toHaveLength(1);
    expect(db.shipments()).toHaveLength(0);
    const order = db.snapshot().orders.find((o) => o.status === "Processing")!;
    db.applyEmailUpdate({
      updateId: db.emailUpdates()[0].id,
      orderId: order.id,
    });
    expect(db.emailUpdates()[0].orderId).toBe(order.id);
    const delivery = extractEmailUpdate(
      "Fwd: Out for delivery 1 item: Example item",
      "",
      received,
      "mail-2",
    )!;
    db.recordInboxScan({ ...scan, updates: [delivery] });
    const row = db.emailUpdates().find((u) => u.externalId === "mail-2")!;
    db.applyEmailUpdate({ updateId: row.id, orderId: order.id });
    expect(db.snapshot().orders.find((o) => o.id === order.id)?.status).toBe(
      "In transit",
    );
    expect(() =>
      db.applyEmailUpdate({
        updateId: db.emailUpdates().find((u) => u.externalId === "mail-1")!.id,
        orderId: order.id,
      }),
    ).toThrow();
    db.disconnectInbox();
    expect(db.emailUpdates()).toHaveLength(2);
    expect(db.snapshot().orders).toHaveLength(36);
  } finally {
    db.close();
  }
});
