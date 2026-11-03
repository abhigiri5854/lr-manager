# LR Manager — Tier 1: Market Truck Operations
Challan (lorry hire) → Advance → POD settlement → Balance payment

Put this file in the repo root next to CLAUDE.md. Prompts in section 8 reference it.

> **Section 9 = client decisions (locked). Where anything else in this file disagrees, section 9 wins.**

---

## 1. What the research says (Nov 2026)

**How the business works.** A market-truck transporter earns the spread: freight charged to the party minus lorry hire paid to the truck owner/broker. Usually advance at loading (often in diesel/cash/bank), balance after POD, minus deductions.

**Where money leaks (what the software must stop):**
1. Wrong hire rate (no reference to past rates on the lane).
2. Advances not recorded (cash, diesel slips) → overpaying balance.
3. Detention/unloading/extra-point paid to the truck but never billed to the party.
4. Shortage/damage not deducted from truck or not claimed.
5. TDS mistakes (wrong rate, missing declaration → disallowance/penalty).
6. Payment to fake/changed bank accounts; duplicate payments.

**Fraud is real.** Fake brokers using fake vehicle numbers to collect advance and disappear; drivers diverting goods mid-route. Fix = verify truck/owner/driver before advance + payment controls.

**Government data (Vahan RC, Sarathi DL, FASTag toll location)** is available via ULIP (goulip.in), but needs registration, use-case review and an NDA. Paid resellers exist. → Build a pluggable "verification provider"; v1 = manual + our free AI reader.

**TDS (from 1 Apr 2026, Income-tax Act 2025).** Old 194C is now Section 393(1) [Table Sl. No. 6(i)]. Rate 1% individual/HUF, 2% others. Nil if the transporter owns ≤10 goods carriages and gives PAN + declaration (393(4)); payer keeps the declaration. Returns must quote the new section. (Thresholds and cash-payment limit below: confirm with CA.)

**E-way bill.** Validity starts when Part B (vehicle) is entered. Vehicle change/transshipment → Part B must be updated before moving. Ship-to GSTIN mandatory for bill-to/ship-to from 1 Aug 2026. Validity: 200 km/day normal cargo, 20 km/day ODC.

**Competitors.**
- Old desktop/web TMS (BTMS, Transport Genius, Bhor etc.): challan for multiple GRs, lorry hire register, broker-wise TDS, shortage report. Powerful but cluttered, no owner transparency, no leak alerts.
- Mobile khata apps (TransportBook, Vyapar): trip P&L, supplier ledger, reminders. Simple but shallow, weak multi-user/branch control.
- **Gap = depth of BTMS + simplicity of a khata app + leak prevention + owner transparency, all free to run.** That's the positioning.

---

## 2. The 12 features that make it great

| # | Feature | Why it sells |
|---|---|---|
| D1 | **Live trip margin** on challan screen: party freight vs hire = ₹ and %; red if below company min margin | Owner sees profit before committing the truck |
| D2 | **Pass-through charges**: one entry at POD (detention, unloading, extra point, labour) marked "pay truck" and/or "bill party" → auto lands on freight bill | Stops the #1 silent leak |
| D3 | **Auto shortage**: loaded pkgs vs delivered pkgs × rate/pkg, allowance %; deduct from truck + optional claim on party | No manual math, fewer disputes |
| D4 | **Truck owner statement link** (no login, read-only, expiring token) shared via WhatsApp `wa.me` link: challans, advances, deductions with reasons, balance | Kills "kitna baaki hai" calls; trust with owners → better truck supply |
| D5 | **Payment safety**: duplicate-payment block, bank-account-change alert + cooling period, maker-checker above limit, cash-limit warning, "unverified owner" warning before advance | Directly fights the fraud patterns |
| D6 | **Manual TDS with helper**: TDS % field starts at 0%, user types any %; helper hint shows suggested rate from PAN (P/H → 1%, others 2%) and warns if no FY declaration on file; deducted at balance; TDS register export | User stays in control, compliance warnings still visible |
| D7 | **Lane rate memory**: last hires on same route + vehicle type shown while typing rate; flags >X% above median | Uses own data, free, saves real money |
| D8 | **Truck KYC by photo**: RC/DL/PAN/declaration photo → existing Gemini reader extracts fields → matches owner name/vehicle no.; expiry alerts (insurance, fitness, permit, DL) | Fast onboarding of new market trucks |
| D9 | **Diesel advance + pump ledger**: advance paid via pump slip debits pump account | Very common in market trucks; BTMS shows "Diesel Amt" |
| D10 | **Pay by Bank or UPI**: owner/broker profile holds bank details + UPI ID + UPI QR image; pay screen shows bank details to copy, generates a UPI QR (from UPI ID + amount + challan no.) and `upi://pay` link; bank bulk CSV export | Pay any way the owner wants, free |
| D11 | **POD photo AI read**: unload date, received pkgs, remarks like "2 bags short" → prefill settlement | Settles in seconds |
| D12 | **E-way checklist on challan**: each LR's EWB no., computed expiry, alert N hrs before; vehicle change → "update Part B" task | Avoids detention/penalty on road |

---

## 3. Flow & status rules

```
LR(s) booked
  → Challan (draft) → Dispatched → In transit → Reached → POD received → Settled
                      │                                        │
              Advance payment(s)                        POD settlement (+/−)
                                                               │
                                                        Balance payment → Settled
Party side: billable pass-through charges → Freight Bill
Vehicle change mid-route: LR moves to new challan, old challan closes partially, Part B task created
```

Rules:
- Balance payment blocked before POD received, unless user has permission + enters reason (logged).
- Editing hire/rate after any payment needs reason → audit log.
- Cancel challan only if no payment; else reverse payments first.
- One LR can be on one active challan at a time (transshipment = explicit "transfer").
- Partial loading: LR pkgs can be split across challans (loaded_pkgs ≤ remaining pkgs).

---

## 4. Calculations (pure functions, all amounts `numeric(14,2)`)

```
hire_amount     = rate                   if basis = TRIP
                = rate × tonnes          if basis = PER_TONNE
additions       = Σ charges where direction = ADD        (extra point, detention, unloading paid by truck, toll…)
deductions      = Σ charges where direction = DEDUCT     (munshiana, commission, shortage, damage, late-POD fee, labour we paid…)
gross_credit    = hire_amount + additions
tds_base        = gross_credit
tds_percent     = MANUAL, default 0 (editable on the balance payment; suggestion hint from PAN type, never auto-applied)
tds             = round(tds_base × tds_percent / 100)   — deducted at BALANCE payment only
net_payable     = gross_credit − deductions − tds
paid            = Σ payment allocations (advance + balance, any mode incl. diesel)
balance         = net_payable − paid      (never stored by hand; SQL view)

shortage_amt    = max(0, loaded_pkgs − delivered_pkgs − allowance) × rate_per_pkg
detention_amt   = max(0, days(reported→unloaded) − free_days) × rate_per_day
late_pod_fee    = if pod_received_at − unloaded_at > N days → fee (setting)

trip_revenue    = Σ allocated LR freight + Σ party-billable charges
trip_cost       = gross_credit (+ own costs if any)
margin          = trip_revenue − trip_cost ; margin% = margin / trip_revenue
```
TDS deducted at balance only (client decision). Charge types decide direction + "bill party" default.

---

## 5. Data model (all tables: `company_id` + RLS, `branch_id` where relevant, `created_by/at`, soft delete)

- **truck_parties** — role: OWNER | BROKER | BOTH; name, mobile, alt_mobile, pan, pan_type (derived), gstin, address, bank_name, account_no, ifsc, account_holder, upi_id, upi_qr_file, bank_changed_at, verified (bool) + verified_by/at, status ACTIVE | BLACKLISTED (+ reason), rating fields, notes
- **tds_declarations** — party_id, fy, file_url, vehicles_owned_declared, received_on
- **market_vehicles** — vehicle_no (normalized, unique per company), owner_party_id, vehicle_type_id, capacity_kg, rc_owner_name, insurance_upto, fitness_upto, permit_upto, puc_upto, rc_file, extracted_json, last_verified_at
- **drivers** — name, mobile, dl_no, dl_upto, dl_file
- **vehicle_types** — company master (e.g. 32ft MXL, 20ft, Taurus 16W…) — no hardcoding
- **charge_types** — code, label, default_direction ADD|DEDUCT, default_bill_party, stage HIRE|POD, active
- **pumps** — name, location, ledger link
- **number_series** — doc_type (CHALLAN, TRUCK_PAYMENT), branch_id, fy, prefix, next_no, padding
- **challans** — number, date/time, fy, branch_id, source, destination, vehicle_id, vehicle_type_id, driver_id, broker_id, payee_party_id (lorry hire from), rate_basis (TRIP | PER_TONNE), rate, qty_tonnes, hire_amount, payee_kind (OWNER | BROKER), remarks, status, dispatched_at, reported_at, unloaded_at, pod_received_at, settled_at, ewb_alert_hours
- **challan_lrs** — challan_id, lr_id, loaded_pkgs, loaded_wt, delivered_pkgs, freight_allocated, ewb_no, ewb_date, ewb_valid_upto, transferred_to_challan_id
- **challan_charges** — challan_id, lr_id (nullable), charge_type_id, stage, direction, amount, bill_party (bool), party_amount, billed_in_freight_bill_id, evidence_file, note
- **truck_payments** — number, date, payee_party_id, mode BANK|UPI|CASH|CHEQUE|DIESEL, pump_id, bank_account_id, ref_no (UTR/cheque), cheque_date, amount, tds_amount, narration, status DRAFT|PENDING_APPROVAL|APPROVED|PAID|REVERSED, approved_by/at
- **truck_payment_allocations** — payment_id, challan_id, kind ADVANCE|BALANCE|ADJUSTMENT, amount, tds_amount
- **share_links** — party_id, token_hash, expires_at, revoked_at, last_opened_at
- **audit_log** — entity, entity_id, action, before_json, after_json, reason, user_id
- **SQL views** — `v_challan_balance`, `v_party_hire_outstanding` (aging buckets), `v_tds_register`, `v_lane_rates` (route + vehicle_type → last N, median)

Accounting postings (if ledger module exists): challan → Dr Lorry Hire Exp / Cr Owner; payment → Dr Owner / Cr Cash|Bank|Pump; TDS → Cr TDS Payable; deductions → Dr Owner / Cr recovery ledger. Ledger names from settings.

---

## 6. Screens

1. **Challan create/edit** — top: branch, date, auto number. LR picker (search LR no. / party / vehicle; shows pkgs remaining). Auto-fill route from LRs. Vehicle field: type number → if unknown, inline quick-add (vehicle + owner + driver, photo upload → AI fill). Hire block (basis, rate with lane-rate hint, qty, charges). Advance block (planned advance, pay now button). Right rail: **margin card**, warnings (unverified owner, blacklisted, expired insurance/DL, rate outlier, EWB expiring), recent challans.
2. **Challan register** — filters (date, branch, status, owner, broker, vehicle); columns incl. hire, paid, balance, POD age; row actions: Pay, POD, Share, Print. Excel/PDF export.
3. **POD settlement** — per challan: dates (reported/unloaded/POD) → detention auto; per LR loaded vs delivered → shortage auto; add charges (direction + bill party toggles); POD file + AI read; summary: net payable, paid, balance. "Mark settled".
4. **Pay truck** — pick payee → list of open challans with balance → allocate (advance/balance); TDS auto; mode; safeguards; approval if above limit; print voucher PDF; share receipt via wa.me.
5. **Truck party profile** — KYC docs, bank (change = alert), declarations by FY, vehicles, ledger, rating (on-time %, shortage incidents, avg rate vs lane), share link controls.
6. **Public owner statement** (`/s/[token]`) — read-only, company name/logo, owner's challans & balances only.
7. **Reports** — Lorry hire outstanding (aging 0-7/8-15/16-30/30+), Advance pending, POD pending (aging), TDS register (section ref from settings), Lane rate report, Broker/owner performance, Trip margin (by party, lane, broker, month), Bank bulk-payment file.
8. **Dashboard widgets** — POD pending aging, hire outstanding, EWB expiring, docs expiring, low-margin trips this week.

---

## 7. Settings per company (nothing hardcoded)
Number series per branch/FY · charge types · vehicle types · TDS: rates, no-PAN rate, thresholds, section label, timing, base · min margin % · rate outlier % · shortage allowance & rate source · detention free days & rate · late-POD days & fee · cash payment warning limit · maker-checker limit · bank-change cooling hours · EWB alert hours · bank file column template · ledger mapping.

---

## 8. Claude Code prompts (run in order; you test + commit after each)

**T1-01 · Opus · Schema**
> Read CLAUDE.md and TIER1-MARKET-TRUCKS.md sections 4–5 and 7. Add Drizzle schema + migrations for all Tier-1 tables, settings fields, and the SQL views. Every table has company_id with RLS matching existing policies; numeric(14,2) for money. Seed nothing company-specific. No UI. List the migration files you created.

**T1-02 · Opus · Calc engine**
> Create `lib/hire/` pure TypeScript functions for every formula in section 4 (hire, additions, deductions, TDS incl. PAN-type + declaration + thresholds, net, balance, shortage, detention, late-POD, margin). Inputs/outputs typed, no DB access, settings passed in. Add a test file with at least 20 cases (rounding, nil-TDS, no-PAN, partial payments, negative-balance guard). Don't run tests; tell me the command.

**T1-03 · Sonnet · Masters**
> Build screens for truck parties, market vehicles, drivers, vehicle types, charge types, pumps, number series using existing shared components and design style. Quick-add drawer components for vehicle/owner/driver reusable from other screens. Bank-account change sets bank_changed_at and writes audit_log.

**T1-04 · Sonnet · Challan create/edit**
> Build section 6 screen 1. Use lib/hire for all numbers. LR picker respects remaining pkgs and one-active-challan rule. Margin card, lane-rate hint from v_lane_rates, warning rail. Save as draft or dispatch. Number from number_series per branch/FY.

**T1-05 · Sonnet · Challan register + print**
> Build screen 2 with filters, balance from v_challan_balance, row actions, Excel export. Add challan PDF using the existing PDF template system (same design language as LR PDF).

**T1-06 · Opus · Payments**
> Build Pay truck (screen 4): allocations across challans, TDS via lib/hire, all modes incl. DIESEL→pump. Safeguards: duplicate block (same payee+amount+challan within 24h needs confirm), bank-change cooling period, maker-checker over limit, cash-limit warning, unverified/blacklisted owner warning, balance-before-POD needs permission + reason. Status workflow + reversal. Voucher PDF + wa.me share text. All in one DB transaction.

**T1-07 · Opus · POD settlement + pass-through**
> Build screen 3. Auto detention and shortage from lib/hire; charges with direction + bill_party. Billable charges must appear as addable lines when creating the party's freight bill and get marked billed (no double billing). Status → POD received / settled with audit.

**T1-08 · Sonnet · Owner statement link**
> Party profile (screen 5) + public route `/s/[token]`. Store only token hash; expiry + revoke; server-side query strictly scoped to that party and company; no other PII; rate-limit. Share button opens wa.me with prefilled message.

**T1-09 · Sonnet · Reports + bank file + dashboard**
> Reports and dashboard widgets from sections 6.7–6.8 using the views. Bank bulk-payment CSV built from the company's column template setting. Excel/PDF export on each report.

**T1-10 · Opus · AI reader extension**
> Extend the existing free reader (QR/text first, Gemini fallback) for RC, DL, PAN, TDS declaration and POD photos. Output fields per section 5. Add samples/*.expected.json cases and include them in scripts/test-readers.ts. Prefill forms; user confirms before save; mismatch (RC owner vs party name) shows warning.

**T1-11 · Sonnet · E-way checklist**
> On challan: list LR EWB numbers, compute valid-upto (km/day from settings, default 200; ODC 20), dashboard alert before expiry, and on LR transfer/vehicle change create a "Update Part B" task. No API calls.

---

## 9. Client decisions (locked, 4 Nov 2026)

| # | Topic | Decision | Build rule |
|---|---|---|---|
| 1 | TDS | Manual, starts at 0% | TDS % input default 0 on balance payment. Show PAN-based suggestion + "no declaration on file" warning as hints only. Never auto-fill a non-zero rate. |
| 2 | TDS timing | At balance | No TDS field on advance payments. |
| 3 | Deductions used | Late POD | Seed only "Late POD fee" as active charge type (days + fee from settings, editable per challan). All other charge types exist in master but inactive until company enables them. |
| 4 | Detention / unloading to party | Manual, optional | Fields blank by default on POD screen. Only if user fills party amount → becomes a billable line for freight bill. No auto-calc of party detention. |
| 5 | Payment approval | Owner | Role "Owner" (company admin) approves payments above the maker-checker limit; limit configurable, can be 0 = all payments need approval, or off. |
| 6 | Rate basis | Per tonne and per trip | Only TRIP and PER_TONNE in v1. Per-tonne: rate × tonnes (tonnes default from LR weights, editable). |
| 7 | Pay broker or owner | Both, depends | On challan: "Pay to" selector OWNER / BROKER (manual). Broker field optional either way. Ledger + statement follow the selected payee. |
| 8 | Payment methods | Bank, UPI ID, UPI QR | Party profile: bank details + UPI ID + upload QR image. Pay screen: mode Bank (copy details, enter UTR) or UPI (show generated QR from UPI ID with amount + note, or the uploaded QR; enter UTR). Cash/cheque/diesel stay available but secondary. |

Still open (default until client says otherwise): advance % and mode → manual amount, any mode, no default %.

**Prompt changes:** T1-02 implements section 4 as updated (manual TDS, TRIP/PER_TONNE). T1-04 shows "Pay to" selector and only two rate bases. T1-06 removes TDS from advances, adds UPI QR generation (use `qrcode` npm package, client-side, no API) and owner approval. T1-07 keeps party detention/unloading blank-by-default.

## 10. Not now (later tiers)
ULIP Vahan/Sarathi/FASTag adapter (after goulip.in approval) · GPS/SIM tracking · driver app · load board/return-load matching · NIC e-way API (paid GSP).
