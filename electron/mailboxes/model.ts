import { z } from "zod";
export const mailboxSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    host: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|[0-9a-f:]+)$/),
    port: z.number().int().min(1).max(65535),
    folder: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\x00-\x1f\x7f]/.test(s)),
    password: z.string().min(1).max(512),
  })
  .strict();
export const mailMigration = `
CREATE TABLE mailboxes(id TEXT PRIMARY KEY,label TEXT NOT NULL,email TEXT NOT NULL,host TEXT NOT NULL,port INTEGER NOT NULL,folder TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,lastSync TEXT,error TEXT,scanned INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0,limited INTEGER NOT NULL DEFAULT 0,UNIQUE(email,host,port,folder));
CREATE TABLE mail_cursors(accountId TEXT PRIMARY KEY,validity TEXT,lastUid INTEGER NOT NULL DEFAULT 0,salesValidity TEXT,salesUid INTEGER NOT NULL DEFAULT 0,salesNext TEXT,lastSync TEXT,scanned INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0,limited INTEGER NOT NULL DEFAULT 0,error TEXT);
CREATE TABLE outstanding_orders(id TEXT PRIMARY KEY,transactionId TEXT NOT NULL,line INTEGER NOT NULL,description TEXT NOT NULL,unitCents INTEGER NOT NULL,quantity INTEGER NOT NULL,amountCents INTEGER NOT NULL,purchaseDate TEXT NOT NULL,kind TEXT NOT NULL,receivedQty INTEGER NOT NULL DEFAULT 0,accountId TEXT,collectionId TEXT REFERENCES collection(id) ON DELETE SET NULL,UNIQUE(transactionId,line));
CREATE TABLE outstanding_receipts(requestId TEXT PRIMARY KEY,lineId TEXT NOT NULL REFERENCES outstanding_orders(id),collectionId TEXT NOT NULL,quantity INTEGER NOT NULL,tab TEXT NOT NULL);
ALTER TABLE collection ADD COLUMN purchaseDate TEXT;
`;
