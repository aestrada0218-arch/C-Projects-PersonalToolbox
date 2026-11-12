# Personal Toolbox · Stage 1

A local-first Windows desktop foundation built with Electron, React, TypeScript, Vite, Tailwind, SQLite (sql.js), Recharts, and Playwright. Original dark-and-gold branding and vector components; no external fonts or runtime services.

## Windows quick start

Install Node.js 22 LTS or newer and Git. Extract this project to a writable folder, then open PowerShell there:

```powershell
npm ci
npm run dev
```

`dev` compiles the Electron main/preload code, starts Vite on port 5173, and opens the desktop window. Renderer changes reload automatically. Restart the command after changing Electron files. Port 5173 must be free.

For the production build:

```powershell
npm run build
npm start
```

Create a Windows installer on Windows:

```powershell
npm run dist:win
```

The NSIS installer is generated in `dist/`. This initial package is unsigned; public distribution requires your own signing certificate and release checks. Do not distribute development builds.

## Test

```powershell
npm test
npm run build
npm run test:e2e
```

Playwright launches the actual installed Electron runtime, so these desktop tests need no separate browser download. Linux CI needs an X display, typically `xvfb-run -a npm run test:e2e`. Tests use isolated temporary databases and remove them afterward. `work/dashboard.png` is produced by the desktop test.

## Working in Stage 1

- Dashboard: period filters, spending chart tooltips, collection category values, total orders, and in-transit shipments.
- Orders: add validated orders, search product/store/ID, filter status, export all orders through an OS save dialog. Export cancellation is supported. CSV cells neutralize spreadsheet formulas.
- Collection: read-only seeded inventory, quantity, purchase/market values, and unrealized profit.
- All nine routes work. Tasks, Proxies, Profiles, Inbox, Expenses, and Settings clearly indicate later-stage scope. Sample task rows never run.
- A new database receives 36 sample orders, six collection entries, and three paused sample tasks. These are illustrative records, not live account data. Collection values are sample valuations, not market feeds. No credential input, email connection, proxy traffic, or automation is active.

## Storage and architecture

```text
electron/main.ts       Window lifecycle, fixed IPC handlers, OS CSV export
electron/preload.ts    Frozen, narrow renderer API
electron/database.ts   Versioned migrations, validation, SQLite persistence
src/types.ts           Shared data contract
src/App.tsx            Dashboard, tables, staged module routes, order form
src/style.css          Original responsive dashboard styling
 tests/                Database and real Electron integration tests
```

SQLite is executed in the main process through sql.js/WASM, avoiding native SQLite rebuild problems across Windows/Electron versions. The full database is written to a sibling temporary file then renamed after successful mutations. This suits a personal Stage 1 database; large datasets should move to a native SQLite adapter and worker process before scaling. A single-instance lock prevents competing application writers.

The database lives at Electron's `app.getPath('userData')/personal-toolbox.sqlite` (normally `%APPDATA%/personal-toolbox/`). Close the app before copying this file as a manual backup. Restore by replacing it while the app is closed. Automated backups and configurable storage belong to Stage 4. Migration 1 creates schema and samples transactionally; later versions must add numbered migrations. Unknown future schema versions are rejected. Failed mutations restore the in-memory snapshot. No automatic reset or data deletion occurs on load errors.

Spending excludes cancelled orders. Period filters affect spending, orders, and shipments; collection valuation always covers the whole inventory. Dates are stored as calendar dates; amounts are USD. Unrealized collection profit is `(market - purchase) × quantity` and excludes fees and taxes. This is not a realized-profit ledger.

## Security boundaries

- Renderer Node integration is disabled. Context isolation, renderer sandbox, web security, CSP, blocked navigation and new windows are enabled.
- IPC exposes three fixed methods; main-process handlers verify the sending window and top-level frame, and validate all order fields with Zod. SQL writes use bound parameters.
- Credentials and tokens are never accepted or logged in Stage 1. Application errors shown across IPC are generic. Ordinary personal/order data is stored unencrypted locally; use Windows account and disk protection as appropriate.
- Windows Credential Manager is a requirement for the later credential adapter. It is intentionally **not** substituted with SQLite or Electron safeStorage, which is not the Credential Manager API. Stage 2 must add a Windows-native `CredWriteW/CredReadW/CredDeleteW` adapter and tests before sensitive profiles, proxy authentication, or provider tokens are enabled. SQLite will hold opaque references only.
- Production release work includes code signing, Windows packaged-installer verification, dependency review, and a tested backup/restore flow. This is a functional Stage 1 foundation, not a completed nine-module product.

## Next stages

1. **Complete (Stage 1):** desktop shell, navigation, validated/migrated SQLite, seeded dashboard, basic order entry/search/export, collection view, tests.
2. **Stage 2:** full order edit/import/export and shipping fields, collection CRUD/images, expenses ledger, Windows Credential Manager adapter, secure profiles and proxy groups.
3. **Stage 3:** task runner with cancellation, scheduling, retries, bounded concurrency and redacted logs; authorized Playwright adapters; provider-based inbox architecture and OAuth.
4. **Stage 4:** preferences, notifications, automated backups/restore, storage management, signed packaging and Windows release validation.

Automation must only operate on authorized accounts and sites and respect their limits. CAPTCHA bypass, queue circumvention, and site-limit evasion are out of scope.

## Validation performed

Verified in the supplied Linux environment with a virtual X display:

- Production TypeScript/Vite/Electron build passed.
- Three SQLite tests passed: migration/seed/reopen, hostile and invalid input rejection, and recovery from an actual persistence failure.
- Production Electron end-to-end test passed: renderer Node isolation, dashboard/chart render, order creation, CSV export, search/status filters, module navigation, and persistence after restart.
- Development-mode Electron end-to-end smoke test passed with Vite and the development-only CSP relaxation needed for React refresh. Production CSP does not permit inline scripts.
- Dashboard screenshot inspected for layout and chart rendering.

Windows NSIS packaging, Credential Manager, and signed Windows installation have not been exercised in this Linux environment. Credential functionality is not present in Stage 1.
