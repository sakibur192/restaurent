# Baybex Restaurant Management System — SaaS

Complete multi-tenant restaurant platform: **POS + Kitchen + Inventory + Accounts + Online ordering**, sold as **one package with every feature**.
Built on **Node.js + Express + PostgreSQL** (raw SQL). **No `.env`, no `.yml`** — configuration is in `config.js` or the web setup page.

---

## 1. Deploy on Coolify (≈10 minutes)

1. **Create the database** — in your Coolify project: *+ New → Database → PostgreSQL*. Start it, then copy its **Postgres URL (internal)**,
   e.g. `postgres://postgres:xxxx@abc123:5432/postgres`.
2. **Create the app** — *+ New → Application*. Either push this folder to a Git repo (GitHub `sakibur192/...`) and connect it,
   or use *Docker / Dockerfile* with this folder.
   - **Build pack:** `Dockerfile`
   - **Ports exposes:** `3000`
   - **Domain:** e.g. `https://restaurant.baybex.com`
3. **Persistent storage** (important) — *Storages → + Add → Volume*, destination path **`/app/data`**.
   This keeps the database connection file and automatic backups across redeploys.
4. **Deploy**, then open `https://your-domain/setup`:
   - paste the Postgres URL from step 1,
   - create your **super admin** email + password,
   - done. Tables are created automatically.

> Prefer hardcoding? Put the URL in `config.js` → `DATABASE_URL: 'postgres://...'` before deploying; then `/setup` only asks for the super-admin account.

Locally: `npm install && node server.js` → http://localhost:3000/setup

---

## 2. Who uses what

| Who | URL | Login |
|---|---|---|
| **You (platform owner)** | `/admin` | super-admin email + password |
| **Restaurant staff** | `/login` | Restaurant ID + username/password **or** a 4–6 digit quick PIN |
| **New restaurants** | `/signup` | self sign-up with free trial (can be turned off) |
| **Guests (QR table / online)** | `/m/<restaurant-id>` (+ `?t=<table QR>`) | none |
| **Self-service kiosk** | `/m/<restaurant-id>?kiosk=1` | none |
| **TV menu board** | `/board/<restaurant-id>` | none |
| **Customer-facing display** | `/display` (2nd screen on the POS PC) | none |
| **Order tracking** | `/track/<token>` | none |

### Super admin can edit everything
Package name, price, billing period, yearly price, trial days, feature list · bKash/Nagad numbers & payment instructions ·
landing page (hero, features, FAQ, SEO) · brand name, logo, colour, contacts, currency · announcements shown to all restaurants ·
restaurants (edit, suspend, extend, set expiry, reset any staff password, **log in as owner**, export data, delete) ·
approve/reject subscription payments, record manual payments · super-admin accounts · login activity · full backup download.

### Multi-level restaurant logins
Default roles: **Owner, Branch Manager, Cashier, Waiter, Kitchen/Chef, Accountant** — the owner can edit any role's permissions
(23 permission switches) or create new roles. Staff can be locked to one branch. Sensitive actions (void, refund, discount)
by staff without permission ask for a **manager PIN** on the spot.

---

## 3. Features (all included)

- **POS & billing** — dine-in / takeaway / delivery / drive-thru, variants & add-ons, item & order discounts, coupons, loyalty redemption,
  VAT (inclusive/exclusive) & service charge, split payments (Cash, Card, bKash, Nagad, Rocket, Due/credit), partial payments,
  hold & resume, split bill, merge bills, move table, open/custom items, sold-by-weight items, barcode scan, receipts (80/58 mm) & KOT printing,
  void/refund with approval, cash shifts with drawer in/out & closing count, **offline billing** (sales queue on the device and sync when the internet returns), keyboard shortcuts (F2/F8/F9).
- **Tables & floor** — floors/sections, live colour-coded floor plan, occupancy timer, waiter assignment, reservations on tables, per-table QR codes (printable).
- **Kitchen display** — station routing (grill, drinks…), timers, late alerts, priority, item-level status, bump, cancelled-item alerts, sound, full-screen mode, "order ready" notifications to waiters.
- **Menu** — categories, photos, SKU/barcode, variants, add-ons, combos, availability toggle, time-based menus, happy-hour price, scheduled price change, branch-only items & branch prices, CSV import/export.
- **Inventory** — ingredients with stock & purchase units (conversion), stock in/out, wastage/damage, adjustments, physical count, branch transfers, batch & expiry, low-stock alerts, full history, central all-branch view, expected-vs-actual variance, **automatic deduction by recipe on every sale**.
- **Recipes & food cost** — cost per portion, food-cost %, profit per dish, yield %, suggested price, version history & restore, ingredient substitution.
- **Purchases & suppliers** — purchase orders, GRN, returns, partial payments, approvals, supplier ledger, dues, price history.
- **CRM** — profiles, history, favourites, segments, birthdays/anniversaries, loyalty points, credit/due with limits, special discount, blacklist, feedback & complaints.
- **QR & online ordering** — mobile menu, cart, pickup/delivery with zones, scheduled orders, coupon, payment note/TrxID, order tracking page, accept/reject, auto-accept option, optional SMS gateway.
- **Delivery** — zones & charges, riders, assignment board, picked/delivered/failed, COD tracking, rider payments & report.
- **Reservations** — bookings, deposits, events, waitlist, confirm/seat/no-show.
- **Staff** — attendance clock in/out, schedules, leaves, salary/advance/bonus/overtime, monthly payroll summary.
- **Accounting** — P&L, cashbook, expenses & categories, other income, cash/bank accounts, journal entries, VAT report, receivables & payables, cash closings, period closing.
- **Reports** — 27 reports incl. daily/monthly/hourly/weekday sales, item & category profit, menu engineering, waiter/cashier/staff, kitchen prep time, table utilisation, cancellations, refunds, discounts, wastage, stock movement, customer retention, 7-day forecast. CSV export & print.
- **Multi-branch** — branch switcher, branch-locked staff, branch comparison, stock transfers, consolidated reports.
- **Security** — bcrypt passwords & PINs, httpOnly cookies, audit log, login history, active sessions (remote log-out), failed-login lockout, tenant isolation on every query.
- **Bangla & English** — the whole app, super admin, guest menu, landing page, login and signup switch between বাংলা and English (button in the top bar). Defaults: *Super admin → Landing page* (website), *Settings → Restaurant* (staff app and guest menu). The Bangla wording lives in `public/js/bn.js` — edit any line there to change a word.
- **Guest menu design** — 8 ready styles (Classic, Midnight dark, Fresh green, Warm bistro, Minimal, Street food, Royal gold, Café pastel), 4 layouts (list, grid, compact, magazine), colours, font, corner roundness, cover photo, show/hide photos and descriptions, with live phone/tablet/desktop preview (*Settings → Menu design*).
- **QR code download** — exact square size in mm / cm / inch, PNG (150–1200 DPI, DPI stored in the file), print-ready PDF or vector SVG, colours, border and damage protection; one table, all tables as a ZIP, the online-menu QR and the kiosk QR.
- **Billing periods** — monthly, 3 months, 6 months, 1 year (add or remove periods, labels and badges in both languages, prices and days) in *Super admin → Package & pricing*. Restaurants pick a period when they pay.
- **Website downloads** — upload PDFs (user manual, brochure, price list…) in *Super admin → Downloads*; they appear on the landing page with download and view buttons and a download counter.
- **Landing page** — every text in English and Bangla is editable in *Super admin → Landing page* (hero, numbers, problems → solutions, feature modules, screenshots, steps, audience, pricing, downloads, FAQ, contact, SEO).
- **Backups** — automatic daily JSON backup in `data/backups` (7 kept), per-restaurant export, full platform export. Images are stored inside PostgreSQL, so a database backup includes them.

---

## 4. Project structure

```
server.js              app entry, setup wizard, static pages, housekeeping/backups
config.js              hardcoded settings (port, optional DATABASE_URL)
src/db.js              PostgreSQL pool + full schema (auto-migrates on start)
src/core.js            sessions, auth, roles/permissions, tenant creation & demo data
src/orders.js          order engine: pricing, VAT, payments, stock deduction, loyalty, split/merge/void/refund
src/routes-super.js    super admin API
src/routes-public.js   signup, login, QR/online menu & ordering, tracking
src/routes-app.js      restaurant API (POS, orders, shifts, kitchen, tables, staff, settings, billing)
src/routes-app2.js     restaurant API (inventory, recipes, purchases, accounting, reports, dashboard)
src/routes-resources.js  generic CRUD for simple records (forms are generated from this schema)
src/qr.js              exact-size QR codes: PNG with DPI, SVG, PDF, ZIP
src/landing-default.js default website text (English + Bangla)
defaults/docs/         PDFs added to the website downloads on first start
public/js/i18n.js      Bangla/English switch;  public/js/bn.js  Bangla wording
public/js/themes.js    guest menu styles
public/                all HTML/CSS/JS (no build step)
Dockerfile             production image for Coolify
```

## 5. Notes

- Change timezone / currency per restaurant in **Settings**; platform currency in **Super admin → Brand**.
- SMS: paste any HTTP GET gateway URL with `{to}` and `{msg}` in **Settings → QR & online ordering**.
- For database-level backups, enable *Backups* on the PostgreSQL resource in Coolify (S3 or local).
