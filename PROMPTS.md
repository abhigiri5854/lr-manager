# Prompts to paste into Claude Code, in order

Run one prompt per session. After each: check the screen in the browser, commit, then type /clear.
Start each with Shift+Tab to enter plan mode, approve the plan, then let it build.

## Phase 0 — Setup
1. Read CLAUDE.md and everything in design/. Set up the project exactly as CLAUDE.md's stack says
   (Next.js, TypeScript strict, Tailwind, pnpm, ESLint, Prettier). Add IBM Plex Sans + Mono and the design
   tokens as Tailwind theme values. Add scripts: dev, build, lint, typecheck. Don't build any screens yet.

## Phase 1 — Shell and shared components
2. Build the app shell from design/screens/Main.dc.html: the sidebar (brand, "Working as" company
   switcher, search, 4 groups with active state) and the main content area. Must stack on phone width.
3. Build components/ui: PageHeader, Card, Field (label + input), Select, Button (primary/secondary/dark),
   Chip (blue/amber/green/grey), DataTable (scrolls sideways on phone), Alert. Match the design files.
4. Create lib/mock with typed sample data (companies, parties, trucks, drivers, lrs, invoices) using the
   values shown in the designs, and lib/data functions the screens will call. Types go in lib/types.ts.

## Phase 2 — Screens with mock data (one prompt each)
5. Dashboard (Main.dc.html)
6. LR register (Register.dc.html) with search + filters
7. New / edit LR (NewLR.dc.html) with party & truck autocomplete and last-LR defaults with Undo
8. LR detail (LRView.dc.html) with status timeline from lib/lr-status.ts
9. POD (POD.dc.html) incl. photo upload UI
10. Parties list + party page (Parties.dc.html)
11. Trucks & drivers (Trucks.dc.html)
12. Tax invoice (Invoice.dc.html) with line totals and GST split
13. Bills & payments (Bills.dc.html) and New freight bill (FreightBill.dc.html)
14. Company profile (Settings.dc.html) with live preview
15. Users & roles (Users.dc.html), Login (Login.dc.html), Driver app (Driver.dc.html)
16. Smart import UI (Import.dc.html) — UI only, no AI yet

## Phase 3 — Database (Supabase Postgres)
17. Design the Drizzle schema for everything in lib/types.ts following CLAUDE.md data rules
    (company_id everywhere, number_series, audit_log, snapshots, soft delete, paise). Show me the
    tables before writing migrations.
18. Write migrations + RLS policies + seed script with the sample data.
19. Replace lib/data mock functions with real queries, one area per prompt (LRs, parties, trucks,
    invoices, bills). Screens must not change.

## Phase 4 — Auth, roles, multi-company
20. Supabase Auth login (mobile/email), user ↔ company ↔ role table, permission checks on server
    actions, company switcher wired to the session.

## Phase 5 — PDFs
21. Build PDF templates matching LRPDF, InvoicePDF, PODPDF, FreightPDF designs, reading all company
    details from the DB; Preview + Download endpoints using Playwright. Store each generated version.

## Phase 6 — AI import
22. Excel/CSV import: SheetJS parse, header detection, column mapping UI, saved mappings, validation,
    duplicate check, import valid rows in one transaction.
23. PDF/photo import: Anthropic API vision → strict JSON schema → validation → open in Tax invoice /
    LR form for review. Never write to DB without user confirmation.

## Phase 7 — Ship
24. Tests for numbering, GST maths, GSTIN validation, status logic; Playwright smoke test per screen.
25. Deploy (app on a Node host that can run Chromium, DB on Supabase), daily backups, error tracking.
