import { describe, it, expect, vi, afterEach } from "vitest";
import { Store } from "../electron/database";
import { InboxService, connectionSchema } from "../electron/inbox/service";
import { extractShipments } from "../electron/inbox/extract";
import {
  WindowsCredentialVault,
  type MailSecret,
} from "../electron/inbox/credentials";
import type { ScanResult } from "../electron/inbox/gmail";
import { randomUUID } from "node:crypto";
const event = {
  tracking: "1Z999AA10123456784",
  carrier: "UPS",
  status: "In transit" as const,
  received: "2026-11-12T12:00:00.000Z",
  subject: "Your package has shipped",
};
const scan: ScanResult = {
  events: [event],
  scanned: 1,
  skipped: 0,
  limited: false,
};
function fixtures(db: Store) {
  let secret: MailSecret | null = null;
  const vault = {
    read: vi.fn(async () => secret),
    write: vi.fn(async (value: MailSecret) => {
      secret = value;
    }),
    remove: vi.fn(async () => {
      secret = null;
    }),
  };
  const provider = { scan: vi.fn(async () => scan), cancel: vi.fn() };
  const service = new InboxService(db, vault, provider, true);
  return { service, vault, provider };
}
const input = { email: "customer@gmail.com", appPassword: "abcdefghijklmnop" };
afterEach(() => vi.useRealTimers());
describe("shipment parsing", () => {
  it("extracts supported tracking numbers and keeps statuses conservative", () => {
    expect(
      extractShipments(
        "Your package has shipped",
        "UPS: 1Z999AA10123456784",
        event.received,
      )[0],
    ).toMatchObject(event);
    expect(
      extractShipments(
        "Your package was delivered",
        "1Z999AA10123456784",
        event.received,
      )[0].status,
    ).toBe("Delivered");
    expect(
      extractShipments(
        "Your package will be delivered tomorrow",
        "1Z999AA10123456784",
        event.received,
      )[0].status,
    ).toBe("In transit");
    expect(
      extractShipments(
        "Out for delivery",
        "1Z999AA10123456784",
        event.received,
      )[0].status,
    ).toBe("Out for delivery");
    expect(
      extractShipments(
        "Tracking update",
        "FedEx tracking number: 123456789012; DHL tracking: 1234567890; USPS 9400111899223856928499; TBA123456789012",
        event.received,
      ).map((s) => s.carrier),
    ).toEqual(["USPS", "Amazon", "FedEx", "DHL"]);
  });
  it("extracts carrier URLs without fetching them and ignores lookalike domains", () => {
    expect(
      extractShipments(
        "Your shipment is arriving",
        "https://www.fedex.com/fedextrack/?trknbr=123456789012",
        event.received,
      )[0].carrier,
    ).toBe("FedEx");
    expect(
      extractShipments(
        "Your shipment is arriving",
        "https://fedex.com.evil.example/?trknbr=123456789012",
        event.received,
      ),
    ).toEqual([]);
    expect(
      extractShipments(
        "Your shipment has dispatched",
        "Carrier: FedEx. Tracking number: 123456789012",
        event.received,
      )[0].carrier,
    ).toBe("FedEx");
  });
  it("ignores generic order digits and status claims in quoted bodies", () => {
    expect(
      extractShipments("Order receipt", "Order 123456789012", event.received),
    ).toEqual([]);
    expect(
      extractShipments(
        "Tracking update",
        "Old history: delivered. 1Z999AA10123456784",
        event.received,
      )[0].status,
    ).toBe("In transit");
  });
});
describe("inbox service and database", () => {
  it("validates credentials, saves only after authentication, deduplicates, applies an explicit link, and disconnects", async () => {
    const db = await Store.open();
    const { service, vault, provider } = fixtures(db);
    try {
      expect(
        (await service.connect({ ...input, appPassword: "normal-password" }))
          .ok,
      ).toBe(false);
      expect(provider.scan).not.toHaveBeenCalled();
      expect(
        connectionSchema.parse({ ...input, appPassword: "abcd efgh ijkl mnop" })
          .appPassword,
      ).toBe(input.appPassword);
      const connected = await service.connect(input);
      expect(connected.ok).toBe(true);
      expect(vault.write).toHaveBeenCalledWith(input);
      expect(JSON.stringify(connected)).not.toContain(input.appPassword);
      await service.refresh();
      expect(service.state().shipments).toHaveLength(1);
      const original = db
        .snapshot()
        .orders.find((o) => o.status === "Processing")!;
      expect(
        service.link({
          shipmentId: service.state().shipments[0].id,
          orderId: original.id,
        }).ok,
      ).toBe(true);
      expect(
        db.snapshot().orders.find((o) => o.id === original.id)?.status,
      ).toBe("In transit");
      db.recordInboxScan({
        ...scan,
        events: [
          {
            ...event,
            status: "Delivered",
            received: "2026-11-13T12:00:00.000Z",
          },
        ],
      });
      expect(service.state().shipments[0].status).toBe("Delivered");
      expect(
        db.snapshot().orders.find((o) => o.id === original.id)?.status,
      ).toBe("In transit");
      db.recordInboxScan(scan);
      expect(service.state().shipments[0].status).toBe("Delivered");
      expect((await service.disconnect()).ok).toBe(true);
      expect(service.state().account).toBeNull();
      expect(service.state().shipments).toHaveLength(1);
      expect(vault.remove).toHaveBeenCalled();
      expect(db.snapshot().orders).toHaveLength(36);
    } finally {
      service.stop();
      db.close();
    }
  });
  it("never stores failed authentication and redacts provider errors", async () => {
    const db = await Store.open();
    const { service, vault, provider } = fixtures(db);
    try {
      provider.scan.mockRejectedValueOnce(
        Object.assign(new Error(input.appPassword), {
          authenticationFailed: true,
        }),
      );
      const r = await service.connect(input);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("Gmail rejected");
      expect(JSON.stringify(r)).not.toContain(input.appPassword);
      expect(vault.write).not.toHaveBeenCalled();
      expect(db.inboxAccount()).toBeNull();
    } finally {
      service.stop();
      db.close();
    }
  });
  it("restores old credentials if database commit fails and preserves the old inbox", async () => {
    const db = await Store.open();
    const { service, vault } = fixtures(db);
    try {
      await service.connect(input);
      const spy = vi.spyOn(db, "connectInbox").mockImplementation(() => {
        throw Error("disk full");
      });
      const r = await service.connect({ ...input, email: "other@gmail.com" });
      expect(r.ok).toBe(false);
      expect(await vault.read()).toEqual(input);
      expect(db.inboxAccount()?.email).toBe(input.email);
      spy.mockRestore();
    } finally {
      service.stop();
      db.close();
    }
  });
  it("prevents concurrent scans and runs only opt-in scheduled checks", async () => {
    const db = await Store.open();
    const { service, provider } = fixtures(db);
    try {
      await service.connect(input);
      vi.useFakeTimers();
      service.start();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(provider.scan).toHaveBeenCalledTimes(1);
      service.setAuto(true);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(provider.scan).toHaveBeenCalledTimes(2);
      let finish!: (value: ScanResult) => void;
      provider.scan.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const running = service.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect((await service.refresh()).error).toContain("already running");
      finish(scan);
      await running;
      service.setAuto(false);
      const count = provider.scan.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(provider.scan).toHaveBeenCalledTimes(count);
    } finally {
      service.stop();
      db.close();
    }
  });
  it("reports missing credentials and rejects cancelled or backward order updates", async () => {
    const db = await Store.open();
    const { service, vault } = fixtures(db);
    try {
      await service.connect(input);
      const delivered = db
        .snapshot()
        .orders.find((o) => o.status === "Delivered")!;
      expect(
        service.link({
          shipmentId: service.state().shipments[0].id,
          orderId: delivered.id,
        }).ok,
      ).toBe(false);
      expect(
        service.link({ shipmentId: "bad", orderId: delivered.id }).ok,
      ).toBe(false);
      await vault.remove();
      expect((await service.refresh()).error).toContain("Reconnect");
      expect(db.inboxAccount()?.error).toContain("Reconnect");
    } finally {
      service.stop();
      db.close();
    }
  });
});
it.runIf(process.platform === "win32")(
  "round-trips an isolated credential through Windows Credential Manager",
  async () => {
    const vault = new WindowsCredentialVault(
      "PersonalToolbox/Test/" + randomUUID(),
    );
    try {
      expect(await vault.read()).toBeNull();
      await vault.write(input);
      expect(await vault.read()).toEqual(input);
      await vault.remove();
      expect(await vault.read()).toBeNull();
    } finally {
      await vault.remove();
    }
  },
  60000,
);
