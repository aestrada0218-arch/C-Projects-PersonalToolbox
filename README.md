# Personal Toolbox · v0.11.0

A Windows desktop app built with Electron, React, TypeScript, Vite, Tailwind CSS, SQLite (sql.js), Recharts, and Playwright. Original dark-and-gold interface. Version 0.6 adds direct eBay fixed-price selling, shared drafts, exact Mercari listing links, and persistent cross-listing follow-ups. Version 0.5 added eBay-email shipping tasks with ship-by dates and scheduled Gmail checks. Version 0.4.1 added illustrated card search and full-title matching. Version 0.4 added a multi-section collection, JustTCG catalog/pricing, saved quote history, and an isolated interactive TCGplayer catalog browser. The categorized expense ledger and recurring bookkeeping remain available.

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
4. Under **TCGplayer / Cards**, search by card name, TCGplayer product URL, or numeric product ID. Choose a game to narrow name searches. Results appear in a responsive image grid, paginated at 20 cards per request. Pasted marketplace titles such as `Mew - B/RGB - ME: 30th Celebration (30C)` search the card name `Mew`, with closest title/set matches ranked first within the returned page. The searched name is shown explicitly; this is a broader related-card search, not a guarantee of every card from a particular set. For an exact product, use its TCGplayer product URL or ID. Before choosing a variant, **From** displays the lowest available variant quote; it is not a TCGplayer lowest listing. Pagination retains the submitted query/game even if you edit the form. Select the exact printing/condition/language before adding a quantity and unit purchase cost; no default variant is assumed.
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
- **Add your photo** lets you choose a local PNG/JPEG, limited to 5 MiB and 4096 × 4096 pixels. Header dimensions are checked before native decoding. Photos are resized to at most 256 × 256 PNG thumbnails and stored locally. JustTCG does not supply card images. Catalog results display public TCGplayer product artwork addressed by the returned numeric product ID, using only `https://tcgplayer-cdn.tcgplayer.com/product/{id}_in_400x400.jpg`. The renderer CSP permits that image path only, rather than arbitrary remote images; image requests send no referrer or JustTCG API key. No storefront HTML is scraped. Artwork is lazily loaded and may be unavailable/offline; a labeled fallback keeps search/add/refresh usable. Linked collection entries retain the product ID and display its artwork after restart without a database migration. Your uploaded photo takes priority. Remote artwork requires a connection and is not copied into SQLite; publisher/artist rights remain with their owners.
- The **Comic books** section already supports independent manual entries, photos, cost/value edits and local history. Live comic catalog search/pricing is intentionally not connected yet. A future approved comic-provider adapter can reuse the collection service/repository/quote structures and register its own source; simply pasting a new website URL is not represented as an automatic pricing integration.
- Removing an item requires confirmation and deletes only that collection row and its history. Disconnecting pricing preserves them. Orders and expenses are separate; adding an item does not duplicate either ledger automatically.

## Selling: direct eBay + assisted Mercari

Open **Collection → Sell item** (tag icon), or use **Selling → New listing draft**. Each pair reserves **one physical copy** from the selected collection entry and assigns an immutable unique SKU. Give it a recognizable label such as a binder position or certification number. Identical titles never link two copies automatically.

This version implements the user-selected assisted Mercari workflow: **eBay publishing and ending use its official API; Mercari publishing, sale reporting and deactivation are manual**. It does not access Mercari through bots, private APIs or injected scripts. It cannot atomically prevent two marketplaces from selling the same copy, and checks stop while Personal Toolbox is closed. Keep the app open and promptly check both platforms on a sale.

### eBay personal-account setup

1. Use your own [eBay Developer Program app keys](https://developer.ebay.com/my/keys). Obtain the correct Client ID/App ID and Client secret/Cert ID for **Sandbox** or **Production**. Do not bundle a shared application secret in a public build. This is a bring-your-own-credentials personal desktop integration; it is not a centrally operated OAuth service.
2. In eBay's Developer user-token flow, authorize your own seller account and obtain a **seller refresh token**, not merely the short-lived access token. Request these four scopes: `https://api.ebay.com/oauth/api_scope`, `https://api.ebay.com/oauth/api_scope/sell.inventory`, `https://api.ebay.com/oauth/api_scope/sell.account.readonly`, and `https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly`. App keys, seller and token must belong to the same environment. See [OAuth authorization and refreshing](https://developer.ebay.com/develop/guides/sell/authorization).
3. Open **Selling → Connect eBay**, choose the matching environment and label, and enter credentials **inside the app**. Fields clear when submitted. Verification reads your locations/policies and checks ownership of existing active app-managed offers before changing a saved connection. Credentials are stored only in Windows Credential Manager at `PersonalToolbox/EbaySelling/v1`; SQLite and renderer state contain no secret or token. The combined JSON is bounded to fit the Windows credential blob limit. No plaintext fallback is used on Linux/macOS. Disconnect clears saved credentials and the cached access token; live listings remain live.
4. Opt your seller account into eBay business policies, and configure **shipping, payment and return policies** in that environment. Refresh policies in Selling. Use an existing inventory warehouse location, or **Add ship-from ZIP** to explicitly create a US warehouse location in your connected eBay account. Only its name and US ZIP/country are sent; a street address is not requested by this form. See [business policies](https://developer.ebay.com/api-docs/sell/static/seller-accounts/business-policies.html) and [Inventory API listing prerequisites](https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html). eBay controls developer access, seller eligibility and any additional account requirements.
5. Test in Sandbox first. Production means real listings, potential selling fees and real buyer commitments. Live seller credentials and API eligibility must be verified on your Windows PC; fixture tests do not establish live seller access.

### Shared draft and eBay publication

- Choose one collection copy, title (up to 80 characters), actual condition, USD selling price and plain description. There is no guessed selling price or grade. In this stage, offers are **EBAY_US**, **USD**, **quantity 1**, **Buy It Now / FIXED_PRICE**, and **Good ’Til Cancelled**; auctions, variations, other regions and bulk quantities are not supported.
- Supply the correct **leaf category ID**. **Load category fields** reads the official Taxonomy and Metadata APIs to show category-specific conditions, required item specifics, grader/grade choices and optional free-text certification details. Fill actual values; dependent category rules are still validated by eBay. Basic item specifics use named fields rather than a JSON editor. The app supports common new/used collectible condition enumerations; unsupported categories/conditions or regulatory requirements may still require eBay's own tools.
- Select ship-from location and all three policies. Saved drafts may remain incomplete, but preparing/publishing requires complete basic fields and at least one image. A category can require additional item specifics/condition descriptors; a server decline preserves the draft and shows numeric eBay error IDs without echoing raw API/credential responses.
- Save the draft, then use **Upload photo** to select your own JPEG/PNG and explicitly upload it through eBay's Media API. Files are limited to 10 MiB, dimensions up to 4096 × 4096, with longest side at least 500 pixels. The main process validates header dimensions, strips metadata by decoding/re-encoding, resizes to at most 1600 pixels and sends a JPEG multipart `image` field. eBay's returned EPS URL is saved with this draft. Alternatively enter your own public HTTPS photo URLs. Collection thumbnails/catalog artwork are never automatically represented as seller-owned listing photos. Upload original files manually when listing on Mercari.
- **Prepare / review** creates or updates an **unpublished** inventory item/offer under the unique SKU. It does not publish. It looks up an existing offer first so an uncertain previous attempt does not blindly create a second one. Already-published offers are reconciled instead of overwritten.
- The final review shows exact copy/SKU, price, quantity, environment, description, condition, policies and photos. A required confirmation checkbox and explicit **Publish live eBay listing** / **Publish sandbox listing** submit a short-lived main-process token bound to the latest draft revision, offer and connection. Editing, relinking, expiration or disconnect invalidates the review. Fees are controlled by eBay; this version does not calculate a seller-fee quote.
- A publish/ending timeout remains **uncertain** and never counts as success. **Check status** retrieves the original offer and verifies its SKU/listing ID. No automatic blind publish retry or automatic relisting of sold copies occurs. Do not manually repurpose an app-generated SKU for another item in eBay.

### Mercari link and sale follow-up

1. **Copy draft**, **Copy title** or **Copy description** copies the saved listing text. Open Mercari selling from the link dialog, create the listing yourself, add original photos, and choose Mercari's category, condition and shipping settings there. Nothing is automatically published to Mercari.
2. Paste the exact `https://www.mercari.com/us/item/m…/` URL into **Link listing** and confirm it is your active listing for the same physical copy. Only the numeric item identifier is saved. One Mercari/eBay listing cannot be assigned to two local pairs. Lookalike domains, userinfo, non-HTTPS and invalid item paths are rejected. Changing a Mercari link requires confirming the old link inactive first; sold pairs remain locked.
3. While open and enabled, the app checks eBay about every **5 minutes**, independently of Gmail's slower shipment/sale scans. It uses the official Fulfillment API and requires **both the exact eBay listing ID and SKU**. Paid/partially-refunded, non-cancelled order lines are deduplicated by environment/order/line ID. A sale on one copy cannot select a similarly named copy. Unpaid/fully-refunded/cancelled orders are not treated as newly confirmed sales; previously recorded sales are never automatically restored to stock on refunds/cancellations.
4. **Sold on eBay → Mercari reminder:** a linked active Mercari item remains visibly active with a persistent removal follow-up. Open the exact link and deactivate it on Mercari. Only then choose **Confirm inactive → I deactivated it on Mercari**. That confirmation changes the local checklist, not Mercari. Browser-opening failures do not complete the reminder.
5. **Sold on Mercari → user reports sale:** use **Record Mercari sale**, verify the exact copy/link and confirm. If the saved per-copy automatic-ending preference is enabled and the owning eBay account is connected, the app verifies the offer/SKU and sends `withdrawOffer`. It marks eBay inactive only after a confirmed response or an authoritative status check. Otherwise it retains a retry/reconnect follow-up. Unpaid offers and cancellations need your direct review; no buyer orders are cancelled automatically.
6. If both platforms report a sale, a double-sale conflict stays visible until you review it directly and acknowledge it locally. Acknowledgment does not refund or cancel either order.

Status, sales, IDs and reminders persist across restart. Automatic checks resume when due; they do not operate while the app is closed or disconnected. Requests are serialized, cancelled on shutdown, use verified fixed-host HTTPS without cookies/redirects, and honor `Retry-After`. Bounded order pages persist their range/offset together with sale events, retaining overlap for deduplication; large backlogs continue on later checks. Only minimal order/line identifiers and sale timestamps are persisted; buyer addresses/raw order bodies are not copied into selling records. General email-derived Needs Shipment remains a separate workflow and is not matched by item title to selling pairs.

### Inventory and editing boundaries

One listing pair reserves one of the collection row's recorded copies. Draft and sold records both consume an allocation, so the same recorded copy cannot be drafted again just because it sold. **Collection quantity/financial valuations are not automatically decremented**; update holdings deliberately and understand that selling allocation is separate from the portfolio's manual ownership/value ledger. Quantity cannot be reduced below saved listing allocations. New actual stock can be recorded separately or by deliberately increasing recorded quantity.

Unused local drafts may be deleted before an eBay offer is created or a Mercari listing linked, releasing that allocation. Created offers/linked or sold pairs are retained for identity/history; live/ended/sold eBay records cannot be edited as fresh drafts. The app does not import or migrate arbitrary pre-existing eBay listings into the Inventory API. Migration 7 preserves existing modules and writes `.pre-selling-v6.bak` before upgrading an existing database.

Primary implementation references: [Inventory API](https://developer.ebay.com/develop/api/sell/inventory_api), [Fulfillment getOrders](https://developer.ebay.com/develop/api/sell/fulfillment_api/order/getOrders), [image management](https://developer.ebay.com/api-docs/sell/static/inventory/managing-image-media.html), [managing offers](https://developer.ebay.com/api-docs/sell/static/inventory/managing-offers.html). Mercari's [automated-access policy](https://www.mercari.com/us/help_center/topics/account/policies/prohibited-conduct/) is why the selected integration keeps Mercari actions user-operated.

## Tasks: Needs Shipment from eBay sale emails

Open **Tasks → Needs Shipment** to manage outgoing orders. Each task has an item title, optional eBay order number, ship-by date, payment status and notes. Dates are calendar dates: overdue, due-today and upcoming labels do not shift the deadline through UTC. Missing dates stay visibly unknown. Add a shipping task manually at any time; editing supports corrections and cancellation. **Mark shipped** moves a task to Shipped, **Reopen** returns it to Needs Shipment, and **Delete** asks for confirmation. These actions update this local checklist only; they do not buy labels, contact buyers, update eBay fulfillment, or adjust collection/expense balances.

### Enable and test automatic sales checks

1. Connect Gmail through **Inbox**, using your Google app password as described below. Tasks reuses that saved Windows Credential Manager credential; do not enter your eBay password.
2. Open **Tasks**. Sales monitoring is enabled by default and checks every **3 hours while the app is running**, independently of Inbox's optional 10-minute incoming-shipment checks. Choose 2, 3, 6 or 12 hours, or pause automatic checks. **Check sales now** performs an explicit check even when the automatic switch is off.
3. The initial check searches Gmail's **INBOX** over the last 90 days, including already-read emails. Matching eBay.com English seller notifications such as **You made the sale for…** and **Great news—your item has sold!** become Needs Shipment tasks. Inline forwards with an eBay sender in the forwarded headers are supported. Buyer purchase receipts, obvious cancellation/refund subjects, marketing messages and lookalike sender domains are excluded. This is email classification, not cryptographic verification of a sale; confirm the order/payment in eBay before fulfillment.
4. The monitor shows the last successful check, next scheduled attempt, errors and skipped-message counts. It resumes overdue checks on startup and handles waking from sleep on the next minute tick. **It cannot check while the app is fully closed**. Disconnecting Gmail pauses access but keeps shipping tasks and their deduplication records.

The dedicated sales query runs separately from incoming-shipment discovery, so a sale subject does not need the word “shipping.” Each scan uses fixed-host Gmail IMAP over verified TLS, read-only INBOX locks and bounded PEEK fetches. It processes the oldest 100 new matching UIDs first, persists the UIDVALIDITY/last-processed-UID cursor only with the saved tasks, and continues a backlog about one minute later while enabled. A mailbox UIDVALIDITY change resets traversal safely; stored message/order receipts still suppress repeats. The initial/recovery lookback remains 90 days; archived mail, spam/trash and attached `.eml` forwards are not searched. Source messages over 1 MiB or unavailable/unparseable messages are counted as skipped. Use eBay/manual task entry for those cases. Failed scans preserve existing tasks/cursor and retry on the configured interval or manually.

The parser preserves HTML table cell boundaries before extracting the explicit **Ship by** date, including labels on a separate line. It accepts English month-name, ISO and US month/day/year deadlines with an explicit year; it never calculates a deadline from “within 30 days.” Missing/unsupported dates or unclear/unpaid notices remain flagged for review. Only the parsed title, order reference, ship-by/payment fields, bounded subject and timestamps are kept for a sale; buyer addresses and raw email bodies are not copied into the task or logged. Email addresses/passwords are not sent to eBay or any pricing provider.

Deduplication is scoped to the connected Gmail account and uses hashed message IDs plus eBay order references when present. Later notices for the same order may fill missing fields on an untouched open task. User edits and shipped/cancelled states take priority. Deleting a task keeps receipt tombstones, so rescanning the same message/order after a restart or reconnect does not recreate it. Without an order reference, a genuinely different message ID cannot reliably be associated with an existing sale; those tasks show a review prompt. A new sale/order can still create a new task. Existing sample automation jobs remain paused examples in the **Automation** tab; the general automation engine is a later stage.

Migration 6 adds shipping tasks, receipt tombstones and monitor settings, with a `.pre-shipping-v5.bak` backup for existing databases. Purchases, collection/prices, expense schedules, Gmail settings and existing sample tasks are preserved. A connected v0.4 account is eligible for the first sales scan at startup without re-entering the saved credential.

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
src/SellingPanel.tsx          Shared drafts, eBay reviews and exact Mercari follow-ups
electron/selling/            eBay provider, secure orchestration, migrations and fixed IPC
src/TasksPanel.tsx            Outgoing sales queue, deadlines, editing and monitor settings
electron/shipping/          Sale parsing, HTML-to-text boundaries, migrations and deduplication
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

The build, provider/service/database tests and Electron UI flows use isolated databases, simulated provider responses and routed fixtures for the remote catalog browser and artwork. They verify exact variant matching, nullable/expired prices, request serialization, quota/cooldown behavior, partial success, key-save rollback/redaction, quote persistence, native-browser isolation, product-ID transfer, manual comics and photo persistence. The artwork test checks a correct product image URL, decoded image dimensions, no referrer/API key on image requests, failed-image fallback without disabling Add, image retention on collection add, and pagination using the submitted query/game. Unit tests cover full-title search normalization and ranking, valid/invalid artwork identifiers, and unchanged exact product lookups. A live public product image was separately fetched successfully over verified HTTPS; those fixtures do not prove every requested product has artwork or pricing. They never send test credentials to the live provider. Two native Credential Manager tests run only on Windows with unique temporary targets and are skipped on Linux. A live JustTCG account/key and the real TCGplayer site's willingness to load in Electron must be verified on the user's PC. Third-party service availability and market prices are not guaranteed by the fixture tests.

### v0.5 shipping verification boundaries

Unit tests exercise eBay-like plain/HTML/forwarded notices, true calendar dates, missing/payment-review fields, sender filtering, UID paging/reset, atomic ingestion/rollback, account isolation, edit/complete/delete preservation, cursor/tombstone persistence, scheduled intervals, pause/resume, reopening catch-up, credential-error redaction, scan serialization and shutdown cancellation. The Electron shipping test seeds parsed fixture emails before launch, then uses the real production preload/IPC/database for manual additions, edits, shipped/cancelled/reopened states, delete confirmation, search, monitor preferences and restart/no-resurrection checks. No production credential or email-provider bypass is added. A live Gmail account is unavailable on this Linux executor; actual eBay email variants and the user's Gmail access still need a live check on Windows.

### v0.6 selling verification boundaries

Tests cover copy allocation, collection deletion/quantity guards, draft and URL validation, revision-bound review confirmation, expired/reused reviews, ambiguous publication reconciliation, exact ID+SKU sale matching, duplicate pages, manual Mercari inactive confirmation, automatic/manual eBay ending, wrong-offer rejection, retained failed-ending follow-ups, double-sale flags, rollback/cursor persistence, account/vault rollback, redaction, restart persistence, serial operations, shutdown and migration from v0.5. Provider fixtures verify official OAuth scopes and payloads, description escaping, one-copy quantity, updateOffer body shape, Media API multipart uploads, category field mapping, minimal order extraction and rate cooldowns. Electron tests exercise real production local IPC for Collection-to-Selling drafts, linking, clipboard export, manual sale/removal confirmations and restart persistence; a separate fixture window tests explicit live-publication review and rejected-credential clearing. No test bypass exists in production and no live eBay or Mercari listing was created during development. Native credential round-trips run only on Windows. Sandbox/production access, live category/account eligibility and real Media API uploads still need verification with your own seller credentials.

### Rollback from v0.7 Entry Runner

This build restores the v0.6 interface and features. A compatibility guard accepts the v0.7 database's additive schema version 8; existing entry tables are retained unused, and ordinary app data remains available. No database downgrade or backup restoration is required.

Close the app before updating. When copying this source over a v0.7 folder, remove the obsolete source files first (these commands do not touch your database or credentials):

```powershell
cd C:\Projects\PersonalToolbox
Remove-Item .\electron\entry -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item .\src\EntryRunnerPanel.tsx, .\src\entry-types.ts, .\tests\entry.test.ts, .\tests\entry.e2e.ts -Force -ErrorAction SilentlyContinue
```

Then copy the extracted source contents containing `package.json` over the project, replacing existing files and keeping `node_modules`. Run `npm install` followed by `npm run dev`. The `rollback.test.ts` regression test verifies that a v0.7 database opens and retains entry tables while existing app data remains writable.

## v0.8 — outstanding purchases, multiple inboxes and order deletion

The Entry Runner remains removed. Proxies and Profiles are no longer shown in navigation.

- **Orders:** use the trash button to review and confirm deletion. Analytics updates immediately. Linked shipment/email records remain saved with their order link cleared; expenses and collection items are not deleted.
- **Collection → Outstanding orders:** click **Scan last 365 days** after connecting Gmail. The primary Gmail account's receipt scan locates Gmail's All Mail folder when available, including archived receipts; it falls back to INBOX when All Mail is unavailable. Other IMAP accounts use the folder you configure.
- Matching requires the exact parsed sender `service@paypal.com`, the **Payment to** section identifying **Minky’s Designs** and `Minkysdesigns@gmail.com`, a completed payment status, transaction ID, purchase date and valid USD line items. The app extracts description, unit price, quantity and amount. HTML is converted locally without fetching images. Forwarded messages with a different outer sender are excluded. Unsupported or unmatched messages appear in scan counts, not guessed purchases.
- Click **Receive / move** to receive all or part of a line's quantity into Cards, Comic books or Other collectibles. Original purchase dates and unit costs are retained. A received item starts with unknown market value and can be updated through the existing collection controls. Shipping-charge lines are retained separately and cannot be moved into the collection. Taxes, discounts and receipt totals are not apportioned into unit prices; imported amounts are the original line amounts, not the final amount charged by PayPal.
- A payment email does not establish whether an item has already shipped or arrived. Historical imports await your receipt confirmation. Use **Include received items** to review received history. Transaction/line identities prevent duplicates across repeated scans and multiple mailboxes; receiving is transactional and request IDs prevent repeated clicks/retries from duplicating a move.

### Connect multiple IMAP inboxes on Windows

Your existing primary Gmail connection is preserved. In **Inbox → Connected inboxes**, choose **Add IMAP inbox** as many times as needed. Choose Gmail or Other IMAP, enter a label, email, verified-TLS hostname/port (normally 993), folder and provider app password. Gmail defaults to `[Gmail]/All Mail`; change the folder if your account uses a different name. Custom servers must support password-based IMAP over implicit TLS; OAuth-only providers need a separate future adapter. TLS verification cannot be disabled. A normal Gmail password does not work; use a Google app password with two-step verification.

Each additional inbox has its own Windows Credential Manager entry, scan cursor, monitoring toggle and error status. There is no imposed account-count limit. Password fields clear after submission and saved passwords are never returned to the renderer or written to SQLite/logs. Each account is verified read-only before credentials are saved. Disconnect removes credentials and stops monitoring, retaining imported purchases and message history. Primary Gmail can be disconnected using its existing account card.

Enabled accounts monitor while the app is open, on a 10-minute schedule. Primary Gmail uses its existing automatic-check switch. Additional accounts use their **Monitor** checkbox. The existing Tasks sales-monitor switch and interval still control eBay sale extraction independently of the primary Gmail shipment auto-check switch. Each inbox has separate sales progress and scheduling. The mailbox scanner also checks sales for connected inboxes and merges shipment/order updates from additional accounts into the Inbox review lists. Mail is read using verified TLS and read-only IMAP; it is never marked read, deleted, or sent by this integration.

PayPal history uses ascending UID batches of at most 100 messages, with a last-365-days search and persisted per-account progress. Larger requested histories continue at the next background tick while the app stays open; **Scan** continues saved progress. Repeated scans do not duplicate existing or received lines. Oversized messages (over 2 MiB), unsupported formats and unrelated PayPal receipts are counted as skipped/unmatched. Review scan counts and your original emails for anything not recognized. No Gmail account was accessed during development; the first real scan runs locally after you connect and request it.

### Update and verification

Close the app, copy the extracted source contents containing `package.json` over `C:\Projects\PersonalToolbox`, replacing existing files and keeping `node_modules`, then run:

```powershell
cd C:\Projects\PersonalToolbox
npm install
npm run dev
```

The database migration creates a `.pre-mailboxes-v8.bak` backup and retains existing orders, expenses, collection, mailbox settings and any unused v0.7 entry tables. It adds mailbox metadata, receipt cursors, outstanding lines, move receipts and collection purchase dates. Do not restore an older backup merely to update.

Run `npm run build`, `npm test` and `npm run test:e2e` to validate. New tests cover the screenshot's line items, HTML receipts, exact sender/payee filtering, 365-day IMAP queries, bounded cursor progression, cross-inbox deduplication, 12 separate mailbox credentials, partial/idempotent receiving, order deletion/unlinking, persistence and desktop controls. IMAP and credential tests use mocks; Windows Credential Manager and real provider authentication require verification on your computer.

### v0.8.1 — receipt scan reliability

Outstanding Orders now requests a receipt-only scan. An unrelated shipment/eBay scan cannot turn a successful receipt import into a receipt-scan failure. Full Inbox scans retain their existing shipment and sales checks.

The per-inbox sales scanner now inherits the previous primary account's saved sales cursor, preventing an upgrade from replaying an older batch behind the existing sales monitor. Cursors from other accounts are never reused. Long receipt batches return completed progress before the hard timeout so a slower mailbox can continue in later batches. No database reset is required.

Failures now identify the inbox and scan stage, with fixed guidance for missing credentials, rejected sign-in, certificate verification, network timeouts, unavailable folders and local storage. Initial primary-account errors are persisted even before a successful first scan. Raw IMAP responses, command text, mail contents and credentials are not exposed. If scanning still fails after updating, use the new error text to determine the next step; live Gmail authentication cannot be verified from development fixtures.

### v0.8.2 — outstanding item controls

FOC shipping and other shipping-charge rows are excluded from Outstanding Orders, including previously imported charges. The original charge rows remain in the local receipt audit data; they cannot be selected or received into collection.

Each item now has an optional **Expected arrival** date. Click the row's **Set date** (or existing date) to edit it. Leave the date blank to clear it. Dates are estimates you enter yourself and do not change purchase dates, received quantities or collection values.

Use row checkboxes or the header checkbox to select matching visible lines, then choose **Set expected date** or **Delete selected**. Changing the search or received-items filter clears the selection so hidden lines are not accidentally changed. Bulk date updates and deletes are transactional: an invalid/stale selection fails without partially changing the remaining lines.

Deletion requires confirmation and applies only to the outstanding line. Any items already moved into collection remain there. A retained deletion marker prevents the same PayPal transaction/line from returning on a later scan or through another inbox. The row trash button supports single-line deletion as well.

The schema-10 migration adds expected-arrival dates and deletion markers and creates a `.pre-outstanding-v9.bak` backup before changing an existing database. Existing receipts, scan progress, collection items and credentials are preserved. Tests cover v9 upgrades, real/invalid dates, date clearing, bulk selection, cancellation, persistence, no re-import after deletion and preservation of already-received items.

## v0.10 — full iPhone editing

The private iPhone companion now opens the full toolbox by default. It reuses the desktop React editors through a fixed, validated server capability list: orders (including a new order editor on Windows too), collection/search/photos/pricing, outstanding orders and bulk actions, expenses and recurring schedules, shipping tasks, inbox account management and selling drafts/controls. Quick view remains available. Changes persist in the same Windows SQLite database immediately.

See [IPHONE_SETUP.md](IPHONE_SETUP.md) for Windows/Tailscale/Safari setup and upgrade instructions. Existing Tailscale Serve forwarding remains valid. After replacing the Windows source and restarting, refresh the iPhone app and pair again if prompted. The PC must stay awake with Personal Toolbox open. There is no offline edit queue or separate mobile database. No schema migration is needed from v0.9.

The phone uses browser photo/file pickers and CSV downloads rather than native Windows dialogs. Collection photos are resized locally; eBay photos are validated/re-encoded on Windows. TCGplayer browsing opens in Safari, with product URLs pasted into the existing card search. Companion enabling, pairing codes and device revocation remain on Windows. Mercari retains its existing assisted workflow; there is no new automatic Mercari posting or delisting.

Gmail/IMAP checks, provider lookups and marketplace operations requested on the phone run on Windows using existing services, validation, limits and publish confirmation. Account passwords/API keys can be submitted over private HTTPS for storage in Windows Credential Manager, but cannot be retrieved. Pair only devices you trust with editing and deleting your data.

The server retains loopback-only binding, private HTTPS origin/host checks, Secure/HttpOnly/SameSite cookies, expiring single-use pairing codes, CSRF protection, session revocation and API no-store headers. It exposes no arbitrary IPC channel, native file path or shell interface. Phone editors freeze record versions and reject conflicting edits from Windows. Per-device request IDs deduplicate interrupted writes for ten minutes; no raw credential input is cached for retries. The service worker caches static app files only and bypasses API requests.

`npm run dev` builds mobile assets before starting Electron. `npm run build` emits desktop/mobile HTML, icons, a manifest and the static service worker; `npm start` opens that production build. Tests use real local stores/server and an iPhone-sized Chromium browser for full editing, photos, CSVs, recurring expenses, outstanding bulk actions and stale-record rejection, alongside existing desktop/API tests. Physical iPhone Safari/Home Screen and live Tailscale/provider behavior require checks on your devices.

## v0.10.1 — remembered iPhone connection

Windows saves the last valid Tailscale HTTPS address and automatically starts the companion on subsequent app launches after it has been enabled. Remembered phone sessions last 30 days from pairing and survive normal app/network restarts. **Pause companion** retains the address and paired devices, while turning automatic startup off. Enable resumes the saved connection. Revoke, phone Unpair and the explicit unpair-all control durably forget devices. Changing the HTTPS origin invalidates existing pairing. The Windows app and Tailscale must still be running on an awake PC.

`companion-settings.json` in Electron's user-data folder stores validated preferences and hashes of high-entropy device tokens, never bearer tokens, CSRF secrets, pairing codes or account credentials. Atomic replacement preserves a complete previous/new version; corrupt settings fail closed and report a recoverable Settings error. Pair/revoke/logout acknowledge success only after settings are saved. CSRF secrets rotate on each PC process restart, and interrupted write IDs from a previous process are rejected before execution. Pair once after upgrading from a version that only kept sessions in memory. No SQLite migration is needed.

Tests cover real-file restore, auto-enable, retained URL/phones after pause, persistent revoke/logout/unpair-all, origin changes, expiration, corruption/storage failures and rejection of old-process writes. The Electron Settings flow verifies remembered URLs and automatic companion startup across actual process restarts.

## v0.10.2 — live desktop refresh after phone saves

A committed database write now sends a fixed, data-free notification to the trusted desktop renderer. The dashboard/Orders and each open data panel reload their local state promptly instead of retaining a startup snapshot or waiting for a polling interval. Database writes from the companion and background services use the same mechanism. Notifications are coalesced during bursts, sent only after a successful save and cleaned up on shutdown. Focus/visibility refresh also catches up a restored desktop window. Existing service status polling remains available.

Refresh updates view data without remounting panels, resetting searches or replacing an unfinished form. A failed database write emits no change notification; a failed view listener cannot undo a committed save. Tests cover notification ordering, rollback, unsubscribe and an actual paired phone editing/adding/deleting while the Electron desktop remains open, including a desktop expense draft that stays intact. No database migration or pairing reset is needed.

## v0.11 — consistent pagination, reference links and collection navigation

Local record lists start at 25 entries per page and offer 50 through **Rows per page**. Orders, collection inventory, outstanding orders, expenses/recurring schedules, shipment tasks, selling copies and inbox email/shipments use a shared pagination hook and controls. Search/category/status filters run over all loaded records in the selected tab before paging; changing a filter or page size returns to the first page, and deleting the last page safely clamps the visible page. Orders no longer has a 200-row display cutoff. The dashboard's recent-orders preview remains five rows. JustTCG remote catalog results retain their provider-supported 20-result request size and existing navigation; local inventory pagination does not consume provider requests.

Manual collection entries now expose **Open reference**, and linked cards retain their TCGplayer product link. Windows validates the saved item's ID and stored HTTPS URL before opening the system browser. The phone resolves the same saved reference through a narrow read-only capability and opens it in the browser. Credentials, non-HTTPS schemes and arbitrary unsaved IPC URL inputs are rejected.

Click a bar or an accessible category button in **Analytics → Collection breakdown** to open Collection filtered to that exact category across all collection sections. A visible category indicator and **Clear category filter** control make the filter explicit. The breakdown is also available in the phone's full workspace.

The shared pagination module replaces repeated table slicing, page-count calculations and footer controls; shared pager styling is defined once. Outstanding **Select all matching lines** still selects matching records across all pages, with the total selected count and existing delete confirmation. Search/received-filter changes clear that selection. No database migration, credential changes or pairing reset is required.

Tests include 231 orders and 61 collection entries to exercise both page sizes, page/filter resets, search beyond the former 200-row cutoff, manual URL opening and exact category navigation, plus reference-URL validation and the existing desktop/phone suite.
