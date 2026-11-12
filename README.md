# Personal Toolbox · v0.4.0

A Windows desktop app built with Electron, React, TypeScript, Vite, Tailwind CSS, SQLite (sql.js), Recharts, and Playwright. Original dark-and-gold interface. Version 0.4 adds a multi-section collection, JustTCG catalog/pricing, saved quote history, and an isolated interactive TCGplayer catalog browser. The categorized expense ledger and recurring bookkeeping remain available.

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

## Collection: TCGplayer browsing and JustTCG pricing

Collection has separate **All items**, **TCGplayer / Cards**, **Comic books**, and **Other collectibles** tabs. Existing collection rows are preserved under Other collectibles as manual estimates; they are not silently linked to a catalog or assumed to have live quotes. You may edit their section. New API-linked cards are kept by exact provider variant ID, including printing, condition, and language; multiple purchases of the same variant can remain separate cost-basis lots.

### Connect the free personal pricing provider

1. Open **Collection → Connect pricing**.
2. Use **Open JustTCG signup/dashboard** to create your own [JustTCG account](https://justtcg.com/). Choose its free personal-use tier and copy your API key from the provider dashboard.
3. Paste the key into Personal Toolbox. The app verifies it with the provider before storing it in Windows Credential Manager at `PersonalToolbox/JustTCG/v1`. It is never committed, logged, stored in SQLite, or returned to the renderer. The password field clears on submission; there is no plaintext fallback on other operating systems.
4. Under **TCGplayer / Cards**, search by card name, TCGplayer product URL, or numeric product ID. Choose a game to narrow name searches. Results are paginated at 20 cards per request. Select the exact printing/condition/language before adding a quantity and unit purchase cost; no default variant is assumed.
5. Use the per-item **Refresh value** button or the header **Refresh values** to request the latest available provider quotes. **Value history** displays up to 100 locally saved observations and a chart. Refresh is on demand; there is no background price polling.

Pricing comes from **JustTCG's own market data**, not from scraping the TCGplayer storefront or from a direct TCGplayer API account. TCGplayer product IDs provide a cross-reference between catalogs. JustTCG's free personal-use tier currently advertises 1,000 requests per billing month, 100 per day and 10 per minute, with up to 20 identifiers per batch. Availability, coverage and plan limits are controlled by the provider and can change. See the primary [pricing](https://www.justtcg.com/pricing), [cards API](https://justtcg.com/docs/api/cards), [variant schema](https://justtcg.com/docs/schema/variant), [rate limits](https://justtcg.com/docs/rate-limits), and [data-source attribution](https://justtcg.com/docs/attributions) pages.

The main process uses the documented v1 `/games` and `/cards` endpoints over verified HTTPS, with the key only in `x-api-key`. Name search uses `q`; a TCGplayer product link uses `tcgplayerId`. Refresh batches at most 20 distinct variant IDs, sharing a fetched quote across lots of the same variant. The local 10-per-rolling-minute request budget and server cooldown are persisted across restarts; `Retry-After` is honored. No automatic retry loop or rate-limit evasion is used. Partial refresh success is retained and remaining failures are reported. Disconnecting removes the key but keeps collection entries and recorded history.

### Browse the requested TCGplayer URL inside the app

**Browse TCGplayer** opens `https://www.tcgplayer.com/categories` in a separate app-owned catalog window. Search and navigate the site normally. On a product page, choose **Catalog → Look up this product in Personal Toolbox**. Only the product ID is passed back to the app, where the approved pricing provider performs the lookup and you choose a variant. You can also use **Look up open product** from the Cards tab.

The site runs in its own nonpersistent session, with no preload, no renderer Node integration, context isolation, sandboxing, denied permissions/downloads and host-restricted top-level navigation/popups. Remote pages cannot call the local Toolbox IPC bridge. The app never runs injected storefront scripts to collect prices or inspect product DOM. If TCGplayer does not support the embedded browser or presents an access challenge, the catalog menu can open the current page in your system browser; copy its product URL into the in-app provider search. The app does not bypass those challenges.

TCGplayer's [API guide](https://docs.tcgplayer.com/docs/getting-started) currently says new API access is closed; its [API terms](https://help.tcgplayer.com/hc/en-us/articles/360061115874-TCGplayer-API-Terms-Conditions) restrict automated storefront data collection outside approved access. The app uses ordinary interactive browsing plus the user-selected JustTCG API instead.

### Valuation, photos and comic-book expansion

- Quantity and purchase cost are per item. **Known market value** sums available unit quotes × quantity; **Purchase cost** includes all holdings; **Unrealized P/L** includes valued entries only and excludes fees/tax. These are estimates, not guaranteed sale proceeds. Trading-card pricing is the v1 ungraded/condition-and-printing catalog, not a graded-slab appraisal.
- A successful refresh saves both the app's checked time and the provider's last-observed time. A refresh may return the same source price/timestamp if no new market report exists. It does not make a daily-cached or older source quote instantaneous.
- Expired/unpriced variants remain unavailable rather than becoming $0. The last recorded price/history is kept separately. Unavailable values are excluded from market totals with a visible count. A network/auth/rate error preserves the prior saved valuation and marks the failed refresh; it does not invent a new timestamp or price.
- **Add item** supports manual cards, comics, and other collectibles. An optional HTTPS reference is informational and does not enable automatic pricing. A blank estimate means unknown; zero remains a legitimate explicit value. Manual edits save price observations when the estimate changes.
- **Edit item** on an API-linked card changes quantity, unit cost, or your photo only. Catalog identity and quote remain tied to the selected variant. Add a different variant as its own item instead of silently reassigning history.
- **Add your photo** lets you choose a local PNG/JPEG, limited to 5 MiB and 4096 × 4096 pixels. Header dimensions are checked before native decoding. Photos are resized to at most 256 × 256 PNG thumbnails and stored locally; no remote card artwork is scraped or loaded by the local renderer. The provider does not supply card images.
- The **Comic books** section already supports independent manual entries, photos, cost/value edits and local history. Live comic catalog search/pricing is intentionally not connected yet. A future approved comic-provider adapter can reuse the collection service/repository/quote structures and register its own source; simply pasting a new website URL is not represented as an automatic pricing integration.
- Removing an item requires confirmation and deletes only that collection row and its history. Disconnecting pricing preserves them. Orders and expenses are separate; adding an item does not duplicate either ledger automatically.

## Expenses

The Expenses screen includes category tabs for **All**, **Proxy Providers**, **Cook Groups**, **Shipping Costs**, **My Collection**, and **Other Expenses**, with per-category entry counts, search by description/provider/retailer, and a paginated ledger. Financial expenses start empty; sample orders/collection entries are never imported into this ledger automatically.

Use **Add expense** to enter description, optional provider/retailer, category, amount in USD, and date. Enable **Recurring** and choose **1 month**, **3 months**, **6 months**, or **Yearly (12 months)**. The amount is the cost per billing period: a $90 quarterly plan contributes $30 to **Recurring / mo**.

- **Total spend** sums all recorded charges due through today's local calendar date, across all categories. **This month** includes due charges in the current calendar month. Future-dated entries appear as Scheduled and are excluded from these spending totals until due. **Entries** counts ledger rows, including future-dated ones. **Recurring / mo** is the rounded monthly equivalent of all active schedules, including future starts; it is a budget estimate, not this month's payments.
- Each recurring occurrence becomes an actual local ledger row with its own date and amount. The app records due charges at startup, on expense reads, and once per minute while running. When reopened, it catches up missed periods. A past start date immediately adds overdue charges. Large backlogs are processed in batches of at most 5,000 occurrences, with a visible notice until caught up. This is bookkeeping based on your schedule, not a bank connection or payment service.
- Recurrence is calculated from the original calendar anchor: January 31 → February 28/29 → March 31. Annual February 29 schedules return to February 29 in leap years. Unique series/date constraints and persisted occurrence cursors prevent duplicates after refresh/restart or deletion of a historical row.
- **Edit charge** changes one recorded entry only. **Edit schedule** changes future description/provider/category/amount/interval and the next billing date without rewriting past entries. Choose a next date today or later; a charge already recorded for that series/date is not duplicated.
- **Stop repeats** preserves past charges. Deleting a charge offers a checkbox to also stop its series. Deleting a charge without stopping its series leaves future repeats active and does not recreate that deleted historical charge. **Delete all** requires confirmation and clears expenses plus schedules across every category. Existing orders, collection and inbox data remain intact.
- Category tabs and search filter the ledger, category subtotal and visible active schedules. Summary cards remain workspace-wide. Money uses integer cents; amount fields accept at most two decimal places. Dates support 1900–2199.

### Expense CSV

**Import CSV** opens a native file dialog, validates the entire file, then shows a preview. Nothing is saved until you confirm. Invalid files are rejected as a whole with a row number; successful imports are transactional. Files are limited to 8 MiB and 20,000 source records.

For a simple spreadsheet, required columns are `description,category,amount,date`; optional columns are `provider,retailer,recurring_months,id`. Use the category names above, amounts such as `12.50`, dates as `YYYY-MM-DD`, and `recurring_months` of `0`, `1`, `3`, `6`, or `12`. A missing interval means a one-time expense. Simple rows with a recurring interval create new automatic schedules, including catch-up charges if the start date is in the past. Rows without IDs append new records on each import.

**Export CSV** exports all categories and all recurring schedules, not just the selected tab. To support lossless schedule/charge restoration, exported files also have `record_type` (`charge`/`schedule`), `schedule_id`, `active`, and `next_index`. Schedule rows define future repeats, while charge rows preserve historical payment amounts and dates; schedule IDs and charge IDs must be unique. Reimporting an exported file skips existing IDs instead of duplicating them and does not overwrite existing records. Keep schedule rows when restoring charges that reference them. CSV quoting supports commas, newlines and escaped quotes. Spreadsheet formulas are neutralized with a leading apostrophe on export, which remains visible if imported into a different database.

## Connect Gmail

1. Enable **2-Step Verification** in your Google Account.
2. Visit **https://myaccount.google.com/apppasswords** in your browser. Create an app password named **Personal Toolbox**. This is different from your normal Google password. Some managed accounts and security configurations do not offer app passwords.
3. In Personal Toolbox, open **Inbox**. Enter your Gmail address and the 16-letter app password. Spaces in the app password are accepted.
4. Click **Connect Gmail securely**. The app tests authentication and scans matching shipping emails before saving the credential.
5. Use **Refresh now**, or enable **Check every 10 minutes while app is open**. Auto-checking is off by default and resumes on app startup only if you enabled it. Closing the app stops checks.
6. Emails without a recognized tracking number appear in **Email updates without tracking**, including inline forwarded order confirmations and Amazon delivery notices. Review each email or detected shipment. Choose the correct order and click **Apply status** to link it and update the order. Later emails update the shipment inbox; applying each change to an order remains manual.

The Windows credential is saved via the native `CredWriteW`, `CredReadW`, and `CredDeleteW` APIs, invoked by a hidden PowerShell process. Secrets travel through stdin/stdout pipes, never command arguments, SQLite, application logs, or renderer storage. The input is cleared on submission and the saved password is never returned to the renderer. Only Windows is supported for connection; other platforms display an unavailable message with no plaintext fallback.

The credential is a **Google app password**, which grants mailbox access. This app uses that access read-only: TLS to `imap.gmail.com:993`, certificate verification, INBOX opened read-only, and PEEK reads. It does not send, mark read, move, or delete email. Your Windows environment must allow PowerShell/Add-Type and Credential Manager access; failures are reported without saving credentials to SQLite.

## Shipment detection limits

- Scans **INBOX**, not Spam, Trash, or archived-only mail. Gmail personal accounts normally have IMAP enabled; administrators must allow it for managed accounts.
- Searches shipping/confirmation-related English subjects and inline-forwarded messages from the **last 30 days**, scanning at most the **newest 100 matches** per check. The screen reports when the cap was reached.
- Skips messages larger than 1 MiB and bounds fetched message size. Scans have connection/socket timeouts and a two-minute deadline. A scan cannot overlap another inbox operation.
- Recognizes UPS `1Z…`, supported USPS numeric formats, Amazon `TBA…`, and FedEx/DHL numbers with explicit carrier labels or supported official tracking URLs. Other carriers, number formats, languages, and subject templates may not match yet.
- Status comes conservatively from the subject, with body text used for tracking extraction. Quoted body histories do not automatically mark a shipment delivered. These heuristics can still be wrong; review them before applying.
- Stores one row per tracking number, updating it only from a newer received email. Relevant messages without recognized tracking are kept separately, deduplicated by a hashed message identity, with inferred status and an order reference when available. No tracking number is invented. SQLite holds your email address, scan settings/counts, tracking number, carrier, subject, received date, inferred status, and optional linked order ID. Email bodies, attachments, remote images, links, and HTML are never displayed or retained.
- Email-derived status is not a live carrier confirmation. Applying out-for-delivery maps the order to **In transit** because orders currently use a smaller status vocabulary. Cancelled orders and backward changes to delivered orders are rejected.
- **Disconnect and clear inbox** removes the Credential Manager entry, account settings, detected shipments, and untracked email updates. Existing orders and applied order statuses remain. To revoke the app password entirely, also delete it in your Google Account.

## Other working modules

- Analytics: period filters, interactive spending/category charts, collection value, order and shipment counts.
- Orders: validated creation, product/store/ID search, status/date filters, all-order CSV export through a save dialog. Spreadsheet formulas are neutralized.
- Collection: sectioned inventory CRUD, local photos, exact-variant JustTCG catalog linking, manual refresh, quote history, and independent manual comics/other collectibles.
- Tasks, Proxies, Profiles and Settings show later-stage scope. Their sample task rows do not run; the opt-in Inbox schedule is independent.

A new database receives 36 illustrative orders, six collection entries and three paused sample tasks. **Inbox starts empty and never mixes sample emails with your account.** Collection values are illustrative, not live market feeds. Spending excludes cancelled orders; collection value covers all inventory. All amounts are USD. Unrealized profit excludes fees and taxes.

## Storage, migrations, and security

Electron `app.getPath('userData')/personal-toolbox.sqlite` is the database (normally `%APPDATA%/personal-toolbox/`). Close the app before copying or restoring it. Migration 1 creates the original schema and samples. Migration 2 adds the inbox tables and preserves existing records; migration 3 adds the untracked-email review table and preserves connected account settings/shipments, with a `.pre-inbox-v2.bak` snapshot before upgrading an existing database; an existing Stage 1 database receives a `.pre-inbox-v1.bak` snapshot before migration. Migration 4 adds expense/schedule tables and saves a `.pre-expenses-v3.bak` snapshot of an existing database before upgrading. Migration 5 adds collection metadata, quote history and pricing-settings tables, preserving IDs/quantities/costs/values; it creates a `.pre-collection-v4.bak` snapshot before upgrading an existing database. Unknown future versions are rejected. Writes use transactions, bound SQL parameters, atomic replacement, and in-memory rollback on persistence failure. A single-instance lock prevents competing app writers.

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
electron/inbox/email-update.ts Forwarded confirmation/untracked-delivery classification
electron/inbox/service.ts     Scheduling, concurrency, redaction and orchestration
src/CollectionPanel.tsx       Collection tabs, catalog, ownership and quote-history UI
electron/collection/         Provider, rate budget, collection storage, browser and fixed IPC
src/ExpensesPanel.tsx         Expense ledger, category tabs and native dialogs
electron/expenses/           Recurrence, validation, persistence, CSV and IPC
src/InboxPanel.tsx            Gmail settings and shipment review
src/App.tsx                   Dashboard, routes, orders and collection
scripts/repair-electron.cjs   Verified Windows Electron binary repair
tests/                       Database, provider, service and Electron UI tests
```

## Validation and remaining stages

Linux verification: TypeScript/Electron/Vite production build; database persistence/migration/failure tests; extraction, duplicate handling, credential-save ordering/rollback, authentication redaction, scheduling and concurrency; TLS/read-only/bounded provider checks; actual Electron dashboard/Inbox UI flows, plus the real persistent Expenses UI covering all four intervals, category/search/keyboard navigation, CSV preview/import/export, charge/schedule edits, delete confirmations and restart persistence. Expense tests cover calendar clamping, cents, catch-up/deduplication, future entries, CSV round-trip/rollback and migration from v0.2.1. Native Windows credential testing and a live Gmail connection cannot be exercised on this Linux executor. The Windows-only test is included for that verification.

Next: complete order/shipping editing/import, collection export/provider expansion, secure profiles and a fuller profit/fee ledger; then bounded authorized task automation, more email adapters/OAuth, preferences/backups, and Windows release hardening. No CAPTCHA bypass, queue circumvention, or site-limit evasion is implemented.

### v0.4 verification boundaries

The build, provider/service/database tests and Electron UI flows use isolated databases, simulated provider responses and a routed fixture for the remote catalog browser. They verify exact variant matching, nullable/expired prices, request serialization, quota/cooldown behavior, partial success, key-save rollback/redaction, quote persistence, native-browser isolation, product-ID transfer, manual comics and photo persistence. They never send test credentials to the live provider. Two native Credential Manager tests run only on Windows with unique temporary targets and are skipped on Linux. A live JustTCG account/key and the real TCGplayer site's willingness to load in Electron must be verified on the user's PC. Third-party service availability and market prices are not guaranteed by the fixture tests.
