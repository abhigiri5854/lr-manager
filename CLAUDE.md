# LR Manager — project rules for Claude Code

Multi-company logistics software: LRs (consignment notes), tax invoices, POD, freight bills,
payments, parties, trucks, AI import, branded PDFs. Used by many companies and users.

## Source of truth for UI
- `design/screens/*.dc.html` = the approved design. Match layout, spacing, colors, copy and order exactly.
- Each file's `<x-dc>` block is plain HTML with inline styles; ignore `<script type="text/x-dc">`,
  `{{…}}` holes and `<sc-for>/<sc-if>` (those are design-tool templating — rebuild them as React).
- Sample data inside designs is SAMPLE ONLY. Never hard-code it.

| Screen | Design file | Route |
|---|---|---|
| Login | Login.dc.html | /login |
| Dashboard | Main.dc.html | / |
| New / edit LR | NewLR.dc.html | /lr/new, /lr/[id]/edit |
| LR register | Register.dc.html | /lr |
| LR detail | LRView.dc.html | /lr/[id] |
| POD | POD.dc.html | /lr/[id]/pod |
| Tax invoices | Invoice.dc.html | /invoices, /invoices/[id] |
| Bills & payments | Bills.dc.html | /bills |
| New freight bill | FreightBill.dc.html | /bills/new |
| Parties | Parties.dc.html | /parties, /parties/[id] |
| Trucks & drivers | Trucks.dc.html | /trucks |
| Item master | — (no design; follows Parties/Trucks lists) | /items |
| Smart import | Import.dc.html | /import |
| Company profile | Settings.dc.html | /settings/company |
| Users & roles | Users.dc.html | /settings/users |
| Driver app | Driver.dc.html | /driver (mobile) |
| PDFs | LRPDF, InvoicePDF, PODPDF, FreightPDF | /pdf/… (server-rendered) |
| Architecture | Flow.dc.html | reference only |

## Stack (do not change without asking)
- Next.js (App Router) + TypeScript (strict) + Tailwind CSS
- PostgreSQL (Supabase) + Drizzle ORM + Zod validation
- Supabase Auth + Storage (logos, POD photos, uploaded files)
- PDFs: HTML templates → Playwright (Chromium) on the server
- AI import: Anthropic API (vision for PDFs/photos); SheetJS for Excel/CSV
- Package manager: pnpm

## Design tokens (from the design files)
- Font: IBM Plex Sans (UI), IBM Plex Mono (LR no., GSTIN, truck no.)
- Navy sidebar #0F1E3D · primary #1F3A8A · primary-soft #E8EEFB · page bg #F4F6FA
- Surface #FFFFFF · border #D9DFEA · input border #C5CDDB · text #111827 · muted #4B5563
- Warning text #7A3A04 on #FEF3E2 · success #146C43 on #E6F4EC
- Radius: cards 12px, inputs/buttons 8px, chips 999px · controls ≥44px tall · page padding 32px
Put these in `tailwind.config` / CSS variables once; never use raw hex in components.

## Data rules (non-negotiable)
- Every business table has `company_id`; every query filters by the active company. Enforce with
  Postgres Row Level Security too.
- No company-specific text in code or PDF templates: names, addresses, GSTIN, bank, terms, POD days,
  penalties, detention, number prefixes all come from `companies` / settings tables.
- Document numbers (LR, freight bill, invoice) are allocated per company + financial year inside a
  DB transaction (row lock on a `number_series` table). Never compute "max + 1" in the app.
- Money stored as integer paise (`bigint`); weights as numeric. Display in Indian format (1,84,902.58).
- Dates stored ISO/UTC; displayed dd-mm-yyyy.
- Parties unique per company by GSTIN; trucks unique per company by number (normalised, no spaces).
- Finalised documents store a JSON snapshot of party + company details used at that time.
- Soft delete / cancel only (`cancelled_at`), never hard delete business records.
- Every create/update writes `audit_log` (user, table, record, old → new).
- Status of an LR is derived in one place (`lib/lr-status.ts`), never set ad hoc in screens.

## Code conventions
- `app/` routes · `components/ui/` shared pieces (Sidebar, PageHeader, Card, Field, Chip, Table)
- `lib/data/` = data access layer. Until the DB exists it returns typed mock data from
  `lib/mock/`; screens must only call `lib/data/*` so swapping to the DB changes nothing in UI.
- `lib/validators/` Zod schemas shared by forms and API (GSTIN, PAN, vehicle no., e-way bill).
- Server Components by default; Client Components only for interactive forms.
- Lists are paginated (50/page) and searchable server-side.

## Working rules for Claude
- One screen or one feature per task. Plan first, then build.
- After a UI task: run `pnpm lint && pnpm typecheck`, then compare against the design file and list
  any differences before finishing.
- After any UI task, use the Playwright MCP browser to open each changed page at 1440px and 390px
  width, take screenshots, compare them with the matching `design/screens` file opened in the
  browser, fix differences, and click through the main form actions once. Report what you checked.
- Never add a new library without saying why.
- Commit after each finished task with a clear message.
