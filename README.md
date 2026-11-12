# Personal Toolbox · v0.2

A Windows desktop app built with Electron, React, TypeScript, Vite, Tailwind CSS, SQLite (sql.js), Recharts, and Playwright. Original dark-and-gold interface. Version 0.2 adds Gmail shipment monitoring to the Stage 1 dashboard.

## Windows launch

Install Node.js 22 or newer, extract the source into a writable folder, and open PowerShell in the folder containing `package.json`. Run these commands one at a time:

```powershell
npm ci
```

```powershell
npm run dev
```

The development command compiles the main/preload processes, starts Vite on local port 5173, then opens Electron. Restart it after changing Electron source. Keep the terminal open while using development mode.

If Electron's binary did not install, the included repair uses the official Electron release ZIP and validates its SHA-256 against the installed package's checksums:

```powershell
node scripts/repair-electron.cjs
```

To update an existing installation, close the app, download the latest source ZIP, and copy the extracted source folder's contents into your existing project folder, choosing Replace. Keep your existing `node_modules` folder so its repaired Electron binary remains installed. Run `npm install` to add new dependencies, then `npm run dev`. The local database is stored separately in AppData.

## Connect Gmail

1. Enable **2-Step Verification** in your Google Account.
2. Visit **https://myaccount.google.com/apppasswords** in your browser. Create an app password named **Personal Toolbox**. This is different from your normal Google password. Some managed accounts and security configurations do not offer app passwords.
3. In Personal Toolbox, open **Inbox**. Enter your Gmail address and the 16-letter app password. Spaces in the app password are accepted.
4. Click **Connect Gmail securely**. The app tests authentication and scans matching shipping emails before saving the credential.
5. Use **Refresh now**, or enable **Check every 10 minutes while app is open**. Auto-checking is off by default and resumes on app startup only if you enabled it. Closing the app stops checks.
6. Review each detected shipment. Choose the correct order and click **Apply status** to link it and update the order. Later emails update the shipment inbox; applying each change to an order remains manual.

The Windows credential is saved via the native `CredWriteW`, `CredReadW`, and `CredDeleteW` APIs, invoked by a hidden PowerShell process. Secrets travel through stdin/stdout pipes, never command arguments, SQLite, application logs, or renderer storage. The input is cleared on submission and the saved password is never returned to the renderer. Only Windows is supported for connection; other platforms display an unavailable message with no plaintext fallback.

The credential is a **Google app password**, which grants mailbox access. This app uses that access read-only: TLS to `imap.gmail.com:993`, certificate verification, INBOX opened read-only, and PEEK reads. It does not send, mark read, move, or delete email. Your Windows environment must allow PowerShell/Add-Type and Credential Manager access; failures are reported without saving credentials to SQLite.

## Shipment detection limits

- Scans **INBOX**, not Spam, Trash, or archived-only mail. Gmail personal accounts normally have IMAP enabled; administrators must allow it for managed accounts.
- Searches shipping-related English subjects from the **last 30 days**, scanning at most the **newest 100 matches** per check. The screen reports when the cap was reached.
- Skips messages larger than 1 MiB and bounds fetched message size. Scans have connection/socket timeouts and a two-minute deadline. A scan cannot overlap another inbox operation.
- Recognizes UPS `1Z…`, supported USPS numeric formats, Amazon `TBA…`, and FedEx/DHL numbers with explicit carrier labels or supported official tracking URLs. Other carriers, number formats, languages, and subject templates may not match yet.
- Status comes conservatively from the subject, with body text used for tracking extraction. Quoted body histories do not automatically mark a shipment delivered. These heuristics can still be wrong; review them before applying.
- Stores one row per tracking number, updating it only from a newer received email. SQLite holds your email address, scan settings/counts, tracking number, carrier, subject, received date, inferred status, and optional linked order ID. Email bodies, attachments, remote images, links, and HTML are never displayed or retained.
- Email-derived status is not a live carrier confirmation. Applying out-for-delivery maps the order to **In transit** because orders currently use a smaller status vocabulary. Cancelled orders and backward changes to delivered orders are rejected.
- **Disconnect and clear inbox** removes the Credential Manager entry, account settings, and detected shipments. Existing orders and applied order statuses remain. To revoke the app password entirely, also delete it in your Google Account.

## Other working modules

- Analytics: period filters, interactive spending/category charts, collection value, order and shipment counts.
- Orders: validated creation, product/store/ID search, status/date filters, all-order CSV export through a save dialog. Spreadsheet formulas are neutralized.
- Collection: read-only seeded inventory, quantities, cost/value and unrealized profit.
- Tasks, Proxies, Profiles, Expenses and Settings show later-stage scope. Their sample task rows do not run; the opt-in Inbox schedule is independent.

A new database receives 36 illustrative orders, six collection entries and three paused sample tasks. **Inbox starts empty and never mixes sample emails with your account.** Collection values are illustrative, not live market feeds. Spending excludes cancelled orders; collection value covers all inventory. All amounts are USD. Unrealized profit excludes fees and taxes.

## Storage, migrations, and security

Electron `app.getPath('userData')/personal-toolbox.sqlite` is the database (normally `%APPDATA%/personal-toolbox/`). Close the app before copying or restoring it. Migration 1 creates the original schema and samples. Migration 2 adds the inbox tables and preserves existing records; an existing Stage 1 database receives a `.pre-inbox-v1.bak` snapshot before migration. Unknown future versions are rejected. Writes use transactions, bound SQL parameters, atomic replacement, and in-memory rollback on persistence failure. A single-instance lock prevents competing app writers.

SQLite/WASM runs exclusively in the main process, avoiding native SQLite rebuilds. It exports the full database after mutations, suitable for a small personal database; large datasets need a native adapter/worker. Ordinary order and shipment metadata are stored unencrypted locally. Automatic backup management and encryption of other future sensitive profile fields are not implemented.

Renderer Node integration is disabled. Context isolation, sandboxing, web security, production CSP, denied navigation/new windows/permissions, narrow frozen preload methods, main-frame IPC sender verification, and main-process validation remain enabled. IMAP protocol logs are disabled. Errors exposed by the inbox are fixed messages, with provider responses/credentials discarded. Untrusted email content never runs as HTML. React escapes subjects and tracking text.

Provider and credential interfaces allow future OAuth/provider adapters. Gmail OAuth, other IMAP providers, a full mail reader, carrier API polling, and sending email are not implemented. Do not send app passwords through chat or commit them to GitHub.

## Build and test

```powershell
npm run build
npm start
```

```powershell
npm test
npm run test:e2e
```

Playwright launches the installed Electron runtime without a separate browser download. Linux needs an X display, typically `xvfb-run -a npm run test:e2e`. Tests isolate their databases. Inbox UI tests use a separate fixture preload in a test-only window; production has no credential/test bypass. Provider tests use simulated IMAP, never a real Gmail account. On Windows, `npm test` additionally exercises a real Credential Manager round-trip with a unique temporary test target, removed afterward.

To build an unsigned NSIS installer on Windows:

```powershell
npm run dist:win
```

Installer output is under `dist/`. Signing, packaged Windows validation, automatic updates and backup/restore release validation remain future work.

## Code map

```text
electron/main.ts              Secure shell and fixed IPC routes
electron/preload.ts           Renderer API
electron/database.ts          SQLite schema, migration and transactions
electron/inbox/credentials.ts Native Windows Credential Manager adapter
electron/inbox/gmail.ts       Read-only Gmail IMAP provider
electron/inbox/extract.ts     Conservative shipment extraction
electron/inbox/service.ts     Scheduling, concurrency, redaction and orchestration
src/InboxPanel.tsx            Gmail settings and shipment review
src/App.tsx                   Dashboard, routes, orders and collection
scripts/repair-electron.cjs   Verified Windows Electron binary repair
tests/                       Database, provider, service and Electron UI tests
```

## Validation and remaining stages

Linux verification: TypeScript/Electron/Vite production build; database persistence/migration/failure tests; extraction, duplicate handling, credential-save ordering/rollback, authentication redaction, scheduling and concurrency; TLS/read-only/bounded provider checks; actual Electron dashboard and Inbox UI flows with fixtures. Native Windows credential testing and a live Gmail connection cannot be exercised on this Linux executor. The Windows-only test is included for that verification.

Next: complete order/shipping editing/import, collection CRUD/images, expense ledger and secure profiles; then bounded authorized task automation, more email adapters/OAuth, preferences/backups, and Windows release hardening. No CAPTCHA bypass, queue circumvention, or site-limit evasion is implemented.
