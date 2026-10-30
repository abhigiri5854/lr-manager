# LR Manager — database design (Phase 3)

Status: **built** (schema, migrations, RLS, seed, integration tests). `lib/data` still reads mock data;
switching it to the database is a later task. PostgreSQL on Supabase, Drizzle ORM schema in
`db/schema/*.ts`, migrations in `db/migrations/`. What changed from the approved design while building
it is listed in §12.

## 1. Ground rules

| Rule                 | How                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ids                  | `uuid primary key default gen_random_uuid()`                                                                                                                                                                                                                                                         |
| Tenant               | every business table has `company_id uuid not null references companies(id)`                                                                                                                                                                                                                         |
| Cross-company safety | every parent has `unique (company_id, id)`; every FK between business tables is **composite** `(company_id, x_id) → parent(company_id, id)`, so a row can never point at another company's party/truck/LR                                                                                            |
| Common columns       | `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `created_by uuid`, `updated_by uuid` (→ users), `cancelled_at timestamptz`, `cancel_reason text`, `version int not null default 1`; check `cancel_reason is null or cancelled_at is not null`      |
| Version              | trigger `c_bump` (`app.tg_bump_row`) sets `updated_at = now()`, `version = old.version + 1`, `updated_by = auth.uid()`. A change to cache columns only (search_text, LR stamps) is not an edit and bumps nothing. App updates with `where id = $1 and version = $expected`; 0 rows → `ConflictError` |
| Created by           | trigger `a_stamp` fills `created_by` / `updated_by` from `auth.uid()` on insert                                                                                                                                                                                                                      |
| Money                | `bigint` paise, `check (>= 0)` unless a value can be negative (round-off, freight bill amount)                                                                                                                                                                                                       |
| Weights / qty        | `numeric(12,3)` (invoice qty `numeric(14,3)`); Drizzle returns strings = `Decimal` type                                                                                                                                                                                                              |
| Rates                | basis points `integer` (500 = 5%), check 0–2800                                                                                                                                                                                                                                                      |
| Dates                | business dates `date`; moments `timestamptz` (UTC). Display dd-mm-yyyy in the app                                                                                                                                                                                                                    |
| Deletes              | **no DELETE on business tables**: `revoke delete`, no RLS delete policy, and trigger `z_no_delete` (also on users, number_series) that refuses even the database owner. Cancel = set `cancelled_at`. Only exception: draft line replacement (§6) and the dev purge switch (below)                    |
| Cancelled rows       | frozen: can't be changed (except cache columns) or un-cancelled (trigger `b_cancel_guard`)                                                                                                                                                                                                           |
| Child lines          | lines are part of their parent record: they carry `company_id` + parent FK, no own `version`/`cancelled_at` (the parent's version guards them). Editing a draft replaces its lines in the same transaction; the parent's audit entry records old → new lines                                         |
| Snapshots            | `snapshot jsonb` on LR, tax invoice, freight bill — written once at book/finalise, then frozen by trigger `d_snapshot_freeze`. One exception: a booked LR may refresh a party's snapshot when that party is swapped for another (`updateLr`); the company part never changes                         |
| Status               | never stored ad hoc. See §5                                                                                                                                                                                                                                                                          |

Trigger names start with a letter so they run in a known order: `a_*` (stamp / checks), `b_*` (guards),
`c_*` (bump), `d_*` (snapshot), `e_*`…`h_*` (business rules, caches, search text), `z_no_delete`.

Drizzle: `businessColumns()` adds the common columns, `businessConstraints()` the `(company_id, id)`
unique and cancel-reason check, `companyFk()` a composite FK plus its `(company_id, col)` index
(`db/schema/_common.ts`). Tables, enums, checks and plain indexes are in the Drizzle schema and
generated by drizzle-kit. Everything else is hand-written SQL:

| Migration                     | Contents                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `0000_extensions.sql`         | `pg_trgm` (in schema `extensions`), schema `app`                                          |
| `0001_tables.sql`             | generated by drizzle-kit from `db/schema`                                                 |
| `0002_functions_triggers.sql` | `app.*` helpers, all triggers, number series functions, view, trigram indexes, privileges |
| `0003_rls.sql`                | table grants and every RLS policy                                                         |
| `0004_storage.sql`            | buckets + `storage.objects` policies                                                      |
| `0005_role_permissions.sql`   | `role_permissions` rows from `lib/permissions.ts`                                         |

Extensions: `pg_trgm`. (`gen_random_uuid()` is built into Postgres; `pgcrypto` isn't needed.)

**Dev purge switch** (dev reset and test cleanup only): `app.purging()` is true only for a non-API
role (not `authenticated` / `anon` / `service_role`) that sets `app.purge = 'on'` in its own
transaction. Then `z_no_delete` and the audit append-only trigger let deletes through, and
`app.purge_company(company)` removes one company and everything in it. Not granted to API roles.

## 2. Enums (Postgres enums, mirrored 1:1 from lib/types.ts)

```
member_role          owner | accountant | booking_staff | driver
lr_payment_mode      to_pay | paid | tbb
gst_payer            consignor | consignee | transporter
charged_as           ftl | per_kg | per_pkg
risk                 owner | carrier
pod_condition        good | short | damaged
freight_gst_mode     reverse_charge | forward_charge
receipt_mode         neft_upi | cheque | cash
record_source        manual | lr | invoice_scan | excel_import
doc_status           draft | final                    -- tax_invoices, freight_bills
number_series_kind   lr | freight_bill | tax_invoice
audit_action         create | update | cancel
audit_actor          user | system
import_source        excel | document
import_format        xlsx | xls | csv | pdf | jpg | png
import_kind          excel | csv | pdf | image
import_detected_as   booking_report | tax_invoice | lr | pod | eway_bill | unknown
import_status        uploaded | read | reviewed | imported | failed
```

`LrStatus` and `TaxInvoiceStatus` are **not** enums — they are derived (§5).

## 3. Tables

`[B]` = has the common business columns from §1. `→ x` = composite FK with company_id.

### 3.1 Companies & people

**companies** (the tenant itself; no company_id) — id, created_at, updated_at, created_by, updated_by,
cancelled_at, cancel_reason, version

- label, name, city (default ''), office (default ''), email, website, mobile1, mobile2
- gstin `text not null` (check GSTIN shape), pan `text not null` (check PAN shape), udyam
- bank_account_name, bank_name, bank_account_no, bank_ifsc — check all four set or all null (= `bank: null`)
- invoice_title (default 'FREIGHT INVOICE'), invoice_note, freight_bill_prefix, tax_invoice_prefix
  (default ''), invoice_round_off bool (default true), numbering_resets_yearly bool (default true),
  freight_gst_rate_bp int (default 500, check 0–2800), signatory_name
- lr_prefix `text not null default ''`, jurisdiction, pod_days int (≥ 0), pod_penalty_per_day_paise
  bigint (≥ 0), lr_copies `text[] not null default '{}'`, detention text, lr_terms text
- logo_path, use_logo_watermark bool (default false), signature_path (Storage paths, §8)
- `nextLrNo` is **not** a column — read from number_series.
- Trigger `f_self_party`: on insert creates the company's self party; on update copies the company's
  details onto it (below).

**users** — id `uuid primary key references auth.users(id) on delete cascade`, name `not null default ''`,
mobile (10 digits, unique where not null), email, last_login_at, created_at, updated_at, cancelled_at.
Not company-scoped. A row is created by trigger on `auth.users` insert (name / mobile from the Auth
user's metadata), and `email` follows `auth.users` email changes. No password column (Supabase Auth
owns credentials).

**memberships** [B] — user_id → users, role member_role

- unique `(company_id, user_id) where cancelled_at is null` and unique `(user_id, company_id) where
cancelled_at is null` (the second serves the RLS lookups)
- trigger `e_keep_one_owner` (after update): refuses an update/cancel that leaves a company with no
  active owner (backstop for `LAST_OWNER_MESSAGE` in `lib/data/members.ts`)

**role_permissions** (lookup, no company_id) — role member_role, action text, PK (role, action).
Seeded from `PERMISSIONS` in `lib/permissions.ts` (`0005_role_permissions.sql`);
`db/tests/permissions.test.ts` asserts the rows and the TS map are identical, so the TS file stays the
single source of truth.

### 3.2 Masters

**parties** [B] — name, place, gstin (check GSTIN shape), pan, phone, address, state_code `char(2)`,
pincode, logo_path, default_from, default_payment_mode, default_gst_payer, default_charged_as,
source record_source (default 'manual'), is_self bool, search_text (generated, §7)

- unique `(company_id, gstin) where gstin is not null and cancelled_at is null`
- unique `(company_id) where is_self` — one self party per company
- **Self party** (today: `lib/self-party.ts`): created by trigger when the company is inserted, and kept
  in step on every company update: name ← name, place ← city, gstin, pan, phone ← mobile1,
  address ← office, state_code ← first 2 characters of the GSTIN, pincode ← last 6-digit PIN in the
  office address. Trigger `b_self_party_guard`: users can't insert a self party, `is_self` never
  changes, and the self party can't be cancelled or have those fields edited from Parties.

**drivers** [B] — mobile `not null` (check 10 digits), name, licence_no, licence_expiry date,
user_id → users (null until invited), invited_at, search_text (generated, §7)

- unique `(company_id, mobile) where cancelled_at is null`; index (user_id)

**trucks** [B] — number (normalised, check `^[A-Z0-9]+$`), driver_id → drivers, rc_expiry,
insurance_expiry, permit_expiry, fitness_expiry, source (default 'manual')

- unique `(company_id, number) where cancelled_at is null`

**items** [B] — code, name, hsn, uom, gst_rate_bp (0–2800), last_rate_paise (≥ 0), search_text
(generated, §7)

- unique `(company_id, lower(code)) where code is not null and cancelled_at is null`

### 3.3 Numbering

**number_series** — company_id, series number_series_kind, fy `text` (check `^\d{4}-\d{2}$`, e.g.
"2026-27"), prefix text (default ''), next_no bigint (check ≥ 1), updated_at. PK `(company_id, series, fy)`;
index (company_id).

- `prefix` = the prefix used for numbers in that FY row (copied from the company setting when the row is
  created). Old FYs keep the prefix they printed with.
- Users never write the table directly (no insert/update grant). All writes go through `security definer`
  functions, inside the document's save transaction, never `max + 1`:

| Function                                      | Who                                                     | Does                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.lock_series(company, kind, fy)`          | (internal)                                              | `select … for update`; missing row → insert with start = 1 if (series ≠ 'lr' and numbering_resets_yearly) else the latest FY's next_no; LR with no row at all → error "Set the next LR number in Company profile first"; `on conflict do nothing`, re-select for update |
| `app.allocate_number(company, kind, fy)`      | `lr.edit` / `bill.edit` / `invoice.edit` for the series | locks, returns `(prefix, no)`, sets `next_no = next_no + 1`. A rollback gives the number back                                                                                                                                                                           |
| `app.peek_number(company, kind, fy)`          | office roles                                            | next number without taking it (null = LR series never set up)                                                                                                                                                                                                           |
| `app.raise_number(company, kind, fy, wanted)` | `company.manage` or the series' edit permission         | locks; refuses to go below the current next number ("Can't go below N"); upsert with `next_no = greatest(next_no, wanted)`                                                                                                                                              |

Same rules as `allocateNumber` / `peekNumber` / `raiseNumber` in `lib/data/_store.ts`.

- Numbers are stored twice on documents: display text (`lr_no`) + the counter (`lr_seq`) and its `fy`,
  so uniqueness and sorting don't parse strings.

### 3.4 LR

**lrs** [B] — import_batch_id → import_batches, lr_no text not null, lr_fy, lr_seq bigint,
lr_date date (null while draft), from_place, to_place, risk (default 'owner'), consignor_id /
consignee_id / billed_to_id → parties, gst_paid_by, payment_mode, charged_as, rate_paise, truck_id →
trucks, driver_mobile, remarks, booked_at, dispatched_at, delivered_at, snapshot jsonb, search_text
`not null default ''` (§7)

- **charges as columns** (fixed set of 9, all `bigint null`, all ≥ 0 like rate_paise): freight_paise,
  packing_paise, cn_charge_paise, loading_paise, unloading_paise, detention_paise, other_paise,
  gst_paise, advance_paise. Balance / grand total stay computed (`lib/lr-charges.ts`).
- **cached lifecycle stamps** (§5): pod_received_at `timestamptz`, billed_at `date`, paid_at `date` —
  written only by triggers
- unique `(company_id, lr_no)` — includes cancelled LRs (the number stays used)
- check `booked_at is null or (lr_date is not null and snapshot is not null)`; lr_fy format

**lr_items** — id, company_id, lr_id → lrs, position smallint, item_id → items, description not null,
packages int (default 0, ≥ 0), actual_weight numeric(12,3), charged_weight numeric(12,3) (≥ 0), size.
unique (lr_id, position).

**lr_invoices** — id, company_id, lr_id → lrs, position, invoice_no not null, invoice_date, value_paise
(≥ 0), eway_bill_no (check 12 digits), eway_expires_at timestamptz, tax_invoice_id → tax_invoices.
The only LR ↔ tax-invoice link (as in types). unique (lr_id, position).

### 3.5 Tax (goods) invoices

**tax_invoices** [B] — invoice_no (null = own draft), invoice_fy, invoice_seq (own invoices only),
invoice_at timestamptz not null, status doc_status (default 'draft'), seller_party_id → parties
(null = this company), bill_to_id → parties not null, ship_to_id → parties,
place_of_supply_state_code char(2) not null, customer_ref, customer_ref_date, so_no, so_date, do_no,
sap_ref, transporter_name, truck_id → trucks, driver_mobile, ship_from, incoterm, irn, eway_bill_no,
source_file_path, import_batch_id → import_batches, snapshot jsonb, search_text `not null default ''`

- totals as columns (not null default 0): taxable_paise, sgst_paise, cgst_paise, igst_paise,
  total_paise (≥ 0), round_off_paise (may be negative)
- unique `(company_id, invoice_fy, invoice_seq) where seller_party_id is null and invoice_seq is not null`
  — own series, cancelled included
- unique `(company_id, coalesce(seller_party_id, '00000000-0000-0000-0000-000000000000'), invoice_fy, invoice_no) where invoice_no is not null`
  — matches `assertUniqueNo` (unique per seller + FY; imported invoices keep the seller's number)
- check `status = 'draft' or (invoice_no is not null and snapshot is not null)`; invoice_fy format

**tax_invoice_lines** — id, company_id, tax_invoice_id → tax_invoices, line_no smallint, item_id →
items, item_code, description not null, hsn, uom, qty numeric(14,3) not null, rate_paise not null,
discount_paise (default 0), taxable_paise not null, gst_rate_bp not null (0–2800), sgst_paise,
cgst_paise, igst_paise (default 0); all amounts ≥ 0. unique (tax_invoice_id, line_no).

### 3.6 POD

**pods** [B] — lr_id → lrs, received_by, receiver_phone, packages_received (≥ 0), condition
pod_condition (default 'good'), remarks, document_paths `text[] not null default '{}'` (Storage paths;
not queried, so no child table), received_at.

- unique `(company_id, lr_id) where cancelled_at is null` — one live POD per LR

### 3.7 Freight bills & payments

**freight_bills** [B] — status doc_status (default 'draft'), bill_no (null until final), bill_fy,
bill_seq, bill_date `not null` (drafts too), party_id → parties not null, gst_mode not null,
gst_rate_bp (default 0, 0–2800), snapshot jsonb, search_text `not null default ''`

- totals as columns (not null default 0): charges_paise, sgst_paise, cgst_paise, igst_paise,
  advance_paise (≥ 0), amount_paise (no ≥ 0 check: advance can exceed charges)
- unique `(company_id, bill_fy, bill_seq) where bill_seq is not null` — cancelled keep their number
- check `status = 'draft' or (bill_no is not null and snapshot is not null)`; bill_fy format

**freight_bill_lines** — id, company_id, freight_bill_id → freight_bills, lr_id → lrs, position,
freight_paise not null, detention_paise, other_paise, advance_paise (default 0), total_paise not null
(all ≥ 0), bill_cancelled_at (copied from the bill by trigger: on line insert and when the bill is
cancelled)

- unique `(company_id, lr_id) where bill_cancelled_at is null` — an LR is on at most one live bill
  (DB backstop for the check in `lib/data/bills.ts`)

**payments** [B] — party_id → parties, amount_paise (> 0), tds_paise (default 0, ≥ 0), mode
receipt_mode, received_on date, reference. No allocations = on-account advance.

**payment_allocations** — id, company_id, payment_id → payments, freight_bill_id → freight_bills,
amount_paise (> 0). unique (payment_id, freight_bill_id).
Trigger `a_check`: the bill must belong to the payment's party and be final and not cancelled
(backstop for `bills.ts`).

**view freight_bill_balances** (security_invoker) — freight_bill_id, company_id, received_paise (sum of
allocations on non-cancelled payments), due_paise (amount − received for a final, live bill; 0 for
drafts and cancelled bills), paid_on (latest received_on once a final, live bill is fully settled).
Replaces `receivedForBill` / `billPaidOn` in `_derive.ts`.

### 3.8 Smart import

**import_batches** [B] — source import_source, file_name, file_path, format import_format,
kind import_kind, mime_type (default ''), size_bytes int, created_by → users, detected_as (default
'unknown'), status import_status (default 'uploaded'), error, result jsonb (`ImportReadResult`),
mapping jsonb, confirmed_columns text[], mapping_name, row_actions jsonb, count_valid / count_warning /
count_error int, created_records jsonb, imported_at.
Index (company_id, created_at desc), (company_id, status), (created_by).

**import_mappings** [B] — name, columns jsonb (header → field key).
unique `(company_id, lower(name)) where cancelled_at is null`.

### 3.9 Audit

**audit_log** — id uuid, company_id, created_at, actor audit_actor, user_id → users (null when
actor = system), batch_id → import_batches, table_name text, record_id uuid, action audit_action,
changes jsonb (`[{field, old, new}]`, default `[]`).

- check `(actor = 'user') = (user_id is not null)`
- append-only: users may only insert (no update/delete grant or policy), and trigger `a_append_only`
  refuses update and delete for everyone, the database owner included (dev purge excepted)
- written by `lib/data` in the same transaction as the change (the existing `writeAudit` helper keeps
  the field-level diff incl. child lines). Imports write `actor = 'system'` with `batch_id`.
- index (company_id, table_name, record_id, created_at desc), (company_id, batch_id)

## 4. How the app talks to the database

- Drizzle + `postgres` (postgres.js), `db/client.ts`. The app uses `DATABASE_URL` — the Supabase
  transaction pooler (port 6543) — with `prepare: false`. Migrations, seed and reset use
  `DATABASE_URL_DIRECT`.
- Every request runs in one transaction (`asUser(db, claims, fn)`) that first does
  `select set_config('request.jwt.claims', <verified claims>, true); set local role authenticated`
  so `auth.uid()` works and **RLS applies to every query** — the app never uses a bypass connection for
  user actions. Claims will come from `supabase.auth.getClaims()` on the server.
- `app.is_system()` = no signed-in user and not an API role (migrations, seed, secret-key server code).
  Definer functions and guard triggers let the system through.
- `lib/data/*` keeps its current signatures; it also keeps `assertCan` for friendly messages.
  RLS is the hard wall behind it.
- The secret key is used only for: the Supabase Auth admin API (`db/auth-admin.ts` — today the seed and
  tests creating users; later invites and password resets, replacing `resetMemberPassword`'s mock), and
  the PDF renderer fetching Storage files.

Scripts: `pnpm db:generate` (drizzle-kit, from `db/schema`), `pnpm db:migrate` (drizzle-orm migrator,
journal `drizzle.__drizzle_migrations`), `pnpm db:seed` (mock data for ACM + RS, every sample user as a
Supabase Auth test user with the same id and the mock password; runs once), `pnpm db:reset` (dev only,
refuses with `NODE_ENV=production`: drops tables, enums, view, schemas `app` and `drizzle`, then
migrates and seeds; keeps Auth users and buckets).

## 5. LR status (one place)

`deriveLrStatus` in `lib/lr-status.ts` stays the only rule. It needs 7 stamps; all are columns on
`lrs`, so no joins are needed to know an LR's status:

| Stamp                                                | Set by                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| cancelled_at, booked_at, dispatched_at, delivered_at | the LR save / POD save (`app.set_lr_delivered`)                                |
| pod_received_at                                      | received_at of the live POD                                                    |
| billed_at                                            | bill_date of the live, **final** freight bill carrying the LR                  |
| paid_at                                              | latest received_on of that bill's live allocations, once they cover its amount |

The last three are worked out by one function, `app.refresh_lr_stamps(company, lr)` — the same rule as
`lrStampsFrom` in `lib/lr-status.ts` — called by `g_lr_stamps` triggers on pods, freight_bills,
freight_bill_lines, payments and payment_allocations, in the same transaction as the change. The
triggers are `security definer` so an accountant recording a payment updates the LR without `lr.edit`.
Trigger `a_stamps_readonly` puts back any direct write to the three stamps. In the mock layer the same
rule runs through `syncLrStampsForPod` / `ForBill` / `ForPayment` in `lib/data/_derive.ts`.

Tests: `db/tests/lr-stamps.test.ts` runs POD, bill and payment writes against the database and checks
the stored stamps against `lrStampsFrom` and `deriveLrStatus`; `lib/data/lr-stamps.test.ts` does the
same for the mock layer.

**Not built yet:** `lrStatusWhere(status)` (the SQL condition per status for the register filter and
dashboard counts) and its every-combination test against the DB. It comes with the `lib/data` switch,
when the first query needs it.

Tax invoice display status ("cancelled" wins) stays in `lib/invoice-status.ts`.

## 6. Row Level Security

RLS on for **every** table (incl. lookups: read-only); `anon` has no table privileges. Policies are in
`0003_rls.sql`. Helpers in schema `app`, `stable security definer set search_path = ''`:

- `app.role_in(company uuid) → member_role` — active membership of `auth.uid()` in an active company
- `app.is_member(company uuid) → bool`
- `app.can(company uuid, action text) → bool` — `role_permissions` lookup
- `app.is_office(company uuid) → bool` — member and role ≠ driver
- `app.my_driver_id(company uuid) → uuid` — live drivers.id where user_id = auth.uid()
- `app.is_own_trip(company uuid, lr uuid) → bool` — LR's driver_mobile = my driver's mobile, or LR's
  truck has me as driver (same rule as `assertPodAccess` in `lib/data/pod.ts`)
- `app.shares_company(user uuid) → bool` — the two users share a company (users SELECT)
- `app.path_part(path, n) → uuid` — n-th folder of a Storage path, null if not a uuid (§8)

| Table(s)                                                   | SELECT                             | INSERT / UPDATE                                                                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| companies                                                  | member                             | update: `company.manage`. No insert grant: only `app.register_company()` (definer fn, service role only — the login page's "Register a new company": company + owner membership + self party + this FY's number_series rows, one transaction) |
| memberships                                                | own row, or `is_office`            | `company.manage`                                                                                                                                                             |
| users                                                      | self, or shares a company with you | update self, columns name / mobile only (column grant); rest via Auth trigger                                                                                                |
| parties, trucks, drivers, items                            | `is_office`                        | `master.edit`                                                                                                                                                                |
| lrs                                                        | `is_office` and `freight.view`*    | insert `lr.edit`; update `lr.edit`, `pod.upload`, or `pod.upload_own` and own trip (column guard below)                                                                      |
| lr_items, lr_invoices                                      | `is_office` and `freight.view`     | `lr.edit`                                                                                                                                                                    |
| tax_invoices, tax_invoice_lines                            | `is_office`                        | `invoice.edit`                                                                                                                                                               |
| freight_bills, lines, payments, allocations, balances view | `freight.view`                     | `bill.edit`                                                                                                                                                                  |
| pods                                                       | `is_office`, or own trip           | `pod.upload`, or `pod.upload_own` and own trip                                                                                                                               |
| import_batches, import_mappings                            | `import.run`                       | `import.run`                                                                                                                                                                 |
| audit_log                                                  | `is_office`                        | insert only: member and (`actor = 'user'` and `user_id = auth.uid()`, or `actor = 'system'` with a batch you created)                                                        |
| number_series                                              | `is_office`                        | none directly — only through the definer functions in §3.3                                                                                                                   |
| role_permissions                                           | any authenticated                  | none                                                                                                                                                                         |

\* every office role has `freight.view` today; the policy names it so a future role without it works.

Extra guards (triggers, because RLS is per row, not per column):

- **Cancel guard** (`b_cancel_guard`) on every [B] table: setting `cancelled_at` needs `record.cancel`
  (owner only today); memberships and companies need `company.manage` (matching `removeMember`);
  import_batches and import_mappings need `import.run` (removing an import file). A cancelled row can't
  be changed or un-cancelled.
- **LR column guard** (`b_lr_column_guard`): a user without `lr.edit` may only change `delivered_at` /
  `dispatched_at` (POD flow), and a driver only on their own trip.
- **Drivers** don't read `lrs` directly (they have no `freight.view`): the driver app uses
  `app.my_trips(company)` (definer fn: id, lr_no, lr_date, from_place, to_place, consignee_name,
  truck_number, booked_at, dispatched_at, delivered_at, pod_received_at — booked, live LRs only, no
  money columns) and records delivery with `app.set_lr_delivered(company, lr, delivered)` (also fills
  `dispatched_at` if empty; needs `lr.edit`, `pod.upload`, or `pod.upload_own` and own trip).
- **Line tables**: DELETE (draft line replacement) only with the parent's edit permission and while
  the parent is editable — lr_items / lr_invoices: LR live and not billed; tax_invoice_lines /
  freight_bill_lines: parent draft and live; payment_allocations: payment live. No DELETE anywhere else.

## 7. Indexes (per screen)

Search uses `pg_trgm` GIN (`extensions.gin_trgm_ops`) on a lower-cased `search_text`. Where all parts
live on the row it is a `generated always as (...) stored` column (parties, drivers, items); where it
needs names from other tables it is kept by trigger `h_search_text` (lrs, tax_invoices, freight_bills)
and refreshed when a line / LR invoice changes, a party's name or GSTIN changes, or a truck number
changes.

| Screen / query                                                                             | Index                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every table                                                                                | `(company_id, id)` unique (composite FKs) + `(company_id, fk)` on every composite FK, unless a wider index starting with it exists                                              |
| LR register search (LR no, places, driver mobile, party names, truck, invoice / e-way nos) | `gin (search_text gin_trgm_ops)` on lrs (trigger-kept)                                                                                                                          |
| LR register default sort                                                                   | `(company_id, created_at desc)`                                                                                                                                                 |
| LR date range                                                                              | `(company_id, lr_date)`                                                                                                                                                         |
| LR by party / truck                                                                        | `(company_id, consignor_id)`, `(company_id, consignee_id)`, `(company_id, billed_to_id)`, `(company_id, truck_id, created_at)`                                                  |
| LR status filter / dashboard open LRs                                                      | partial `(company_id, created_at desc) where cancelled_at is null and delivered_at is null`                                                                                     |
| POD pending / overdue                                                                      | partial `(company_id, delivered_at) where delivered_at is not null and pod_received_at is null and cancelled_at is null`                                                        |
| Unbilled TBB                                                                               | partial `(company_id) where payment_mode = 'tbb' and booked_at is not null and cancelled_at is null` + live-line unique on freight_bill_lines(lr_id)                            |
| Repeat routes                                                                              | partial `(company_id, consignor_id, consignee_id, lr_date desc) where booked_at is not null and cancelled_at is null`                                                           |
| E-way alerts                                                                               | partial `lr_invoices (company_id, eway_expires_at) where eway_bill_no is not null`                                                                                              |
| Driver trips                                                                               | `lrs (company_id, driver_mobile)`                                                                                                                                               |
| Parties search / sort                                                                      | generated search_text (name, place, gstin, phone) GIN trgm; `(company_id, lower(name))`                                                                                         |
| Trucks / drivers search                                                                    | trucks `gin (number gin_trgm_ops)`; drivers generated search_text (name, licence, mobile)                                                                                       |
| Doc expiry alerts                                                                          | trucks partial `(company_id, rc_expiry)` / insurance / permit / fitness `where cancelled_at is null`; drivers partial `(company_id, licence_expiry) where cancelled_at is null` |
| Items search / pick-list                                                                   | generated search_text (code, name, hsn) GIN trgm; `(company_id, lower(code) text_pattern_ops)` for code-prefix                                                                  |
| Tax invoice list                                                                           | `(company_id, invoice_at desc)`, `(company_id, status)`, `(company_id, bill_to_id)`, search_text (no., bill-to name, GSTIN, linked LR nos)                                      |
| Bills list                                                                                 | `(company_id, bill_date desc)`, `(company_id, party_id)`, `(company_id, status)`, search_text (no., party, LR nos)                                                              |
| Payments                                                                                   | `(company_id, party_id, received_on desc)`; allocations `(company_id, freight_bill_id)`                                                                                         |
| POD received list                                                                          | pods `(company_id, received_at desc)`                                                                                                                                           |
| Membership / RLS lookups                                                                   | memberships unique `(user_id, company_id) where cancelled_at is null`                                                                                                           |
| Number series                                                                              | `(company_id)`                                                                                                                                                                  |
| Import history                                                                             | `(company_id, created_at desc)`, `(company_id, status)`, `(created_by)`                                                                                                         |
| Audit / LR activity                                                                        | `(company_id, table_name, record_id, created_at desc)`; `(company_id, batch_id)`                                                                                                |

## 8. Storage

Four **private** buckets (`0004_storage.sql`, upserted so re-running keeps them in step). Object path
always starts with the company id: `{company_id}/{record_id}/{uuid}-{file name}`.

| Bucket     | Holds                        | Path                                                           | Limit / types                         | Read                     | Write                                              |
| ---------- | ---------------------------- | -------------------------------------------------------------- | ------------------------------------- | ------------------------ | -------------------------------------------------- |
| logos      | company logo, party logos    | company: `{company}/{company}/…`; party: `{company}/{party}/…` | 2 MB · png, svg, jpeg                 | `is_office`              | `company.manage` (company) / `master.edit` (party) |
| signatures | signature / stamp            | `{company}/…`                                                  | 2 MB · png, svg, jpeg                 | `is_office`              | `company.manage`                                   |
| pod        | signed LR copies, POD photos | `{company}/{lr}/…`                                             | 3 MB · image/*, pdf                   | `is_office`, or own trip | `pod.upload`, or `pod.upload_own` + own trip       |
| imports    | Smart import originals       | `{company}/…`                                                  | 10 MB · xlsx, xls, csv, pdf, jpg, png | `import.run`             | `import.run`                                       |

Policies on `storage.objects` (named `lr_manager_*`) read the folders with `app.path_part(name, n)`
(null for a non-uuid folder, so a bad path is simply refused) and the same `app.*` helpers. There are
select and insert policies only — no update or delete: files are never changed or deleted (cancelled
records keep theirs). Tables store the **path**; `lib/data` will turn it into a short-lived signed URL
when reading, so UI fields like `logoUrl` keep working. Serving SVGs with
`Content-Disposition: attachment` (except through `<img>`) is the app's job when it serves files.

## 9. Environment variables (.env.local)

You fill these in yourself; none are committed (`.env*` is already in .gitignore) and none are
printed. All come from the Supabase dashboard.

| Variable                               | Where it's used                                                                                          | Where to find it                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | browser + server Supabase client; Auth admin API (`db/auth-admin.ts`)                                    | Project Settings → API → Project URL                                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server auth (safe to expose; RLS protects data)                                                | API Keys → publishable key (`sb_publishable_…`; legacy name: anon key)                |
| `SUPABASE_SECRET_KEY`                  | server only: Auth admin (seed / test users, later invites, password reset), PDF renderer reading Storage | API Keys → secret key (`sb_secret_…`; legacy: service_role). **Never** `NEXT_PUBLIC_` |
| `DATABASE_URL`                         | app runtime (Drizzle) and the DB integration tests                                                       | Connect → Transaction pooler (port 6543)                                              |
| `DATABASE_URL_DIRECT`                  | migrations, seed, reset, drizzle-kit                                                                     | Connect → Session pooler / direct (port 5432)                                         |
| `DATA_SOURCE`                          | `db` (default) or `mock` — where `lib/data` reads and writes                                             | not a secret                                                                          |
| `ANTHROPIC_API_KEY`                    | Smart import reader (when the mock reader is replaced)                                                   | console.anthropic.com                                                                 |

`SESSION_SECRET` (today's mock login) is removed once Supabase Auth is in.

## 10. Type changes vs lib/types.ts

| Change                                                                                                                                                                      | Why                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Lr` gains read-only `podReceivedAt: IsoDateTime \| null`, `billedAt: IsoDate \| null`, `paidAt: IsoDate \| null`; `LrStatusInput` is now a `Pick` of the seven `Lr` stamps | stored stamps (§5); `toLrView` stops scanning pods/bills/payments |
| `cancelReason?: string` moved to `BaseRecord` (the copies on `Party`, `Lr`, `TaxInvoice` are gone)                                                                          | every business table has `cancel_reason`                          |
| `BaseRecord` gains `createdBy: Uuid \| null`, `updatedBy: Uuid \| null`                                                                                                     | stamped by trigger; useful in activity / audit                    |
| `User` — no password field in the DB                                                                                                                                        | Supabase Auth owns credentials; the mock's hash stays mock-only   |
| `Company.nextLrNo` stays in the type but is read from `number_series`                                                                                                       | it was never a real column                                        |
| `AuditEntry.userId: Uuid \| "system"` → DB has `actor` + nullable `user_id`; `lib/data` maps back to `"system"`                                                             | a uuid FK column can't hold `"system"`                            |
| `ImportBatch.counts` ↔ 3 int columns; `createdBy` ↔ FK                                                                                                                      | mapping only, type unchanged                                      |
| `*Url` fields (`logoUrl`, `signatureUrl`, `documentUrls`, `fileUrl`, `sourceFileUrl`) stay URLs in types; DB stores `*_path`                                                | private buckets need signed URLs made at read time                |
| Internal: `lrSeq`/`lrFy`, `billSeq`/`billFy`, `invoiceSeq`/`invoiceFy` not exposed in types                                                                                 | used only for uniqueness/sorting inside lib/data                  |

No enum or field renames otherwise — Drizzle column names are snake_case, mapped to the existing
camelCase types (`db/rows.ts` maps mock records to rows for the seed).

## 11. Deliberate choices (confirmed)

1. **LR charges as 9 columns**, not an lr_charges table (fixed set, always read together).
2. **Unique truck number / GSTIN / driver mobile only among non-cancelled rows**, so a cancelled
   truck can be added again. LR, invoice and bill numbers are unique **including** cancelled ones.
3. **Tax-invoice uniqueness includes the seller** (own series + imported sellers' numbers), which is
   what the current code enforces; the plain `(company_id, series, fy, no)` would block two sellers
   sharing a number.
4. **Audit written by the app** (keeps today's field-level diffs incl. lines), DB makes it insert-only.
5. **Libraries added:** `drizzle-orm`, `postgres` (driver), `drizzle-kit` (dev). `@supabase/supabase-js`
   and `@supabase/ssr` are **not added yet** — they come with the Supabase Auth login; until then
   `db/auth-admin.ts` calls the Auth admin REST API with `fetch`.

## 12. Changes during implementation

Everything below differs from the design as approved; the sections above already describe the built
version.

**Structure and tooling**

1. RLS policies are hand-written SQL (`0003_rls.sql`), not `pgPolicy` in the Drizzle schema: they call
   `app.*` helpers that only exist after the functions migration, and most are generated in loops over
   table groups.
2. Six migrations (§1 table): generated tables in `0001`, everything else hand-written in `0000`,
   `0002`–`0005`. `pg_trgm` lives in schema `extensions`; `pgcrypto` isn't created (`gen_random_uuid()`
   is built in).
3. `db:migrate` uses the drizzle-orm migrator (journal `drizzle.__drizzle_migrations`), not
   `drizzle-kit migrate`. `DATABASE_URL_DIRECT` is used by migrations **and** seed / reset, not
   drizzle-kit only.
4. `@supabase/supabase-js` / `@supabase/ssr` not added yet; `db/auth-admin.ts` uses `fetch` against the
   Auth admin API (§11.5).
5. `app.raise_number` needed `#variable_conflict use_column`: its `fy` parameter clashed with the `fy`
   column in `on conflict (company_id, series, fy)`.

**Deletes, cancels, versions**

6. "No delete" is also a trigger (`z_no_delete`) on every business table, `users` and `number_series`,
   not only missing grants/policies — so it holds for the database owner too.
7. New dev purge switch: `app.purging()` + `app.purge_company()` (dev reset / test cleanup only, never
   granted to API roles).
8. Cancelled rows are frozen (no edits except caches, no un-cancel). The design only guarded setting
   `cancelled_at`.
9. Cancel permission per table: `record.cancel` for most, `company.manage` for companies and
   memberships, `import.run` for import_batches / import_mappings (removing an import file isn't an
   owner-only cancel).
10. `bump_row` doesn't bump the version for cache-only changes (search_text, the three LR stamps), so
    a trigger refreshing a cache never causes a `ConflictError`. New `a_stamp` trigger fills
    `created_by` / `updated_by` on insert.
11. Snapshot freeze allows one LR case: refreshing a party's snapshot when that party is swapped for
    another (`updateLr`).
12. audit_log append-only is also a trigger (refuses update/delete for every role, owner included).

**Companies, users, self party**

13. companies also has `created_by` / `updated_by`, plus column defaults (invoice_title
    'FREIGHT INVOICE', round-off on, yearly reset on, GST 500 bp, empty prefixes). `register_company()`
    sets `lr_copies` to Consignor / Consignee / Driver / Office and creates **all three** series rows
    (LR included) for the current FY (IST) starting at 1.
14. users: `name not null default ''`, mobile check (10 digits), `on delete cascade` from `auth.users`,
    email follows `auth.users` email changes; users update only name / mobile via a column grant.
15. memberships has both unique indexes `(company_id, user_id)` and `(user_id, company_id)`;
    `keep_one_owner` is an AFTER UPDATE trigger.
16. Self party is created by trigger on **every** company insert (not inside `register_company` only) and
    syncs more fields than designed: also place, pan, state_code (from GSTIN) and pincode (from the
    office address). Users can't insert a self party and `is_self` can't change.

**Numbering**

17. number_series: no update policy and no insert/update grant — all writes go through the definer
    functions `app.lock_series` / `allocate_number` / `peek_number` / `raise_number` (§3.3). The
    design's per-series update policy was dropped.
18. `raise_number` is allowed with `company.manage` **or** the series' edit permission (saving an LR
    with a hand-typed number moves the LR series on — `lib/data/lrs.ts`), is an upsert (creates the FY row if missing), and
    errors when asked to go below the current next number instead of silently keeping it.
19. Extra `(company_id)` index on number_series; `prefix` defaults to ''.

**LR, POD, stamps**

20. `billed_at` and `paid_at` are `date` (bill_date / received_on), not timestamps;
    `pod_received_at` stays `timestamptz`. `Lr.billedAt` / `paidAt` are `IsoDate` in the types.
21. One function `app.refresh_lr_stamps` (same rule as the new `lrStampsFrom` in `lib/lr-status.ts`)
    instead of separate per-table trigger logic; direct writes to the stamps are put back by
    `a_stamps_readonly`.
22. `lrStatusWhere()` and its every-combination DB test are **not built yet** — deferred to the
    `lib/data` switch. The consistency test that exists compares DB stamps with `lrStampsFrom` /
    `deriveLrStatus` (`db/tests/lr-stamps.test.ts`).
23. LR column guard allows `dispatched_at` as well as `delivered_at` without `lr.edit` (recording
    delivery fills an empty dispatch date). New definer fn `app.set_lr_delivered()` for drivers, who
    can't select (so can't update) `lrs`. The lrs update policy names `pod.upload` / own trip.
24. `app.my_trips()` columns fixed (§6); only booked, live LRs.
25. Line DELETE rules made concrete per table (§6): LR lines while the LR is live and not billed;
    payment allocations while the payment is live.
26. Allocation check also requires the bill to be final and not cancelled.
27. Extra checks not in the design: all LR charges and rate ≥ 0, FY format on lrs / tax_invoices /
    freight_bills, weights / packages / values ≥ 0, GST rates 0–2800 on items, lines and bills,
    pod_days / penalty ≥ 0, driver mobile 10 digits. freight_bills.amount_paise has **no** ≥ 0 check.
28. Not-null / defaults made explicit: freight_bills.bill_date not null (drafts too), gst_rate_bp
    default 0; tax_invoices.invoice_at and place_of_supply_state_code not null; lrs.risk default
    'owner'; pods.condition default 'good'; search_text `not null default ''` on trigger-kept tables.

**Search, view, indexes, storage**

29. LR search text also includes driver mobile; party-change refresh fires on name **and GSTIN**
    (invoice search has the bill-to GSTIN).
30. `freight_bill_balances` columns: freight_bill_id, company_id, received_paise, due_paise (0 for
    drafts / cancelled), paid_on.
31. Index changes: audit batch index is `(company_id, batch_id)` (composite FK) not `(batch_id)`;
    new `import_batches (created_by)`; drivers licence-expiry index is partial (live only); FK indexes
    are skipped where a wider index already starts with the same columns (payments party, LR truck).
32. New helpers: `app.is_member`, `app.is_system`, `app.shares_company`, `app.path_part`,
    `app.financial_year`, `app.series_permission`, `app.self_party_pincode`.
33. Storage: path layouts fixed per bucket (§8); policies use `app.path_part()` instead of
    `storage.foldername(name)[1]::uuid` (no cast error on a bad path); select + insert policies only.
    SVG `Content-Disposition` is left to the app.
34. Seed: sample users get `seed.<name>@example.com` when they have no e-mail (Supabase Auth needs one)
    and the mock password; the seed runs once (does nothing on a seeded DB).

**After the first switch to the database (prompt 19a)**

35. `0006_mock_login.sql`: helpers for the mock login while it runs on the database —
    `app.login_lookup(code, identifier)` (anon: the account for a company code + mobile / e-mail), `app.record_login`,
    `app.find_company_user` (invite: the person with this mobile / e-mail in this company), `app.can_reset_password`,
    `app.company_gstin_taken`; anon gets usage on schema `app` for `login_lookup` only. People
    invited without an e-mail get a placeholder Auth e-mail and `users.email` stays empty.
36. `0007_goods_gst_40.sql`: items and tax invoice lines allow GST up to 40% (4000 bp, the app's
    `GST_RATES_BP`); the design's 0–2800 refused 40% items. Freight bills stay at 0–2800.
37. Logos and signatures are uploaded to Storage with the secret key after `lib/data` checks the
    permission in the user's RLS transaction (no user token until Supabase logins, prompt 20);
    they are read through short-lived signed URLs.


## One login = one company (migration 0011)

- `companies.code` (unique among active companies, `^[A-Z0-9]{3,10}$`) is typed on the login page.
- One active membership per user (`memberships_one_company_per_user`); `users.company_id` follows the membership (trigger). `users.mobile` / `users.email` are unique **per company**, so the same person can have a separate login in each company. Auth e-mails of new logins are made-up (`u-<id>@lrm.invalid`); the real e-mail lives in `users.email`.
- The migration kept each multi-company user's first company and gave every other company its own new account (same name / mobile / e-mail, random password — the Owner resets it from Users & roles).
