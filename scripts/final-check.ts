// Final browser check of the whole app on the DEV database (dev server on localhost:3000).
//   pnpm exec tsx --env-file-if-exists=.env.local scripts/final-check.ts
// Uses puppeteer-core (already a dependency, drives the PDF renderer) with CHROME_EXECUTABLE_PATH.
// Writes final-check/report.md and screenshots. Creates records named "TEST-…" on the dev database.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer, { type Browser, type ElementHandle, type Page } from "puppeteer-core";
import { navGroups } from "../lib/navigation";

const BASE = process.env.CHECK_BASE ?? "http://localhost:3000";
const OUT = "final-check";
const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
] as const;
const PASSWORD = "demo1234";
const USERS = {
  owner: { code: "ACM", id: "seed.owner@example.com" },
  accountant: { code: "ACM", id: "accounts@example.com" },
  staff: { code: "ACM", id: "seed.booking-staff@example.com" },
} as const;
type Role = keyof typeof USERS;

const RUN = Date.now().toString().slice(-6);
const issues: string[] = [];
const steps: string[] = [];
const issue = (page: string, vp: string, role: string, kind: string, detail: string) =>
  issues.push(`- \`${page}\` · ${vp} · ${role} · **${kind}** · ${detail.replace(/\s+/g, " ").slice(0, 220)}`);
const step = (name: string, ok: boolean, detail = "") =>
  steps.push(`- ${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 300)}` : ""}`);

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "root";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- small DOM helpers ----------
async function control(page: Page, re: RegExp): Promise<ElementHandle<HTMLElement> | null> {
  const h = await page.evaluateHandle(
    (src, flags) => {
      const rx = new RegExp(src, flags);
      for (const l of Array.from(document.querySelectorAll("label"))) {
        if (rx.test(l.textContent ?? "")) {
          const c = (l as HTMLLabelElement).control;
          if (c && (c as HTMLElement).offsetParent !== null) return c;
        }
      }
      return null;
    },
    re.source,
    re.flags,
  );
  return h.asElement() as ElementHandle<HTMLElement> | null;
}

/** Types into the control whose label matches; for a <select>, picks the option matching `value` (or the first real one). */
async function setField(page: Page, re: RegExp, value: string | "FIRST"): Promise<boolean> {
  const el = await control(page, re);
  if (!el) return false;
  const tag = await el.evaluate((e) => e.tagName);
  if (tag === "SELECT") {
    const v = await el.evaluate(
      (e, want) => {
        const opts = Array.from((e as HTMLSelectElement).options).filter((o) => o.value);
        const hit = want === "FIRST" ? opts[0] : opts.find((o) => o.text.toLowerCase().includes(want.toLowerCase()));
        return hit?.value ?? null;
      },
      value,
    );
    if (v === null) return false;
    await (el as ElementHandle<HTMLSelectElement>).select(v);
    return true;
  }
  await el.click({ count: 3 });
  await el.type(value, { delay: 5 });
  return true;
}

async function clickText(page: Page, re: RegExp, within = "button, a, [role=tab], [role=option], [role=menuitem]") {
  const h = await page.evaluateHandle(
    (src, flags, sel) => {
      const rx = new RegExp(src, flags);
      const visible = (e: Element) => (e as HTMLElement).offsetParent !== null;
      return (
        Array.from(document.querySelectorAll(sel)).find(
          (e) => visible(e) && rx.test((e.textContent ?? "").trim()) && !(e as HTMLButtonElement).disabled,
        ) ?? null
      );
    },
    re.source,
    re.flags,
    within,
  );
  const el = h.asElement() as ElementHandle<HTMLElement> | null;
  if (!el) return false;
  await el.click();
  return true;
}

async function settle(page: Page) {
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 20_000 }).catch(() => {});
}

async function pickFromCombobox(page: Page, labelRe: RegExp, text: string) {
  const el = await control(page, labelRe);
  if (!el) return false;
  await el.click({ count: 3 });
  await el.type(text, { delay: 20 });
  await page.waitForSelector("[role=option]", { timeout: 8000 }).catch(() => {});
  return clickText(page, /./, "[role=option]");
}

// ---------- per-page watchers ----------
type Watch = { errors: string[]; stop: () => void };
function watch(page: Page): Watch {
  const errors: string[] = [];
  const onResp = (r: import("puppeteer-core").HTTPResponse) => {
    if (r.status() >= 500) errors.push(`5xx ${r.status()} ${r.url().replace(BASE, "")}`);
  };
  const onErr = (e: unknown) => errors.push(`pageerror ${(e as Error)?.message ?? e}`);
  const onCons = (m: import("puppeteer-core").ConsoleMessage) => {
    if (m.type() === "error") errors.push(`console ${m.text()}`);
  };
  page.on("response", onResp);
  page.on("pageerror", onErr);
  page.on("console", onCons);
  return {
    errors,
    stop: () => {
      page.off("response", onResp);
      page.off("pageerror", onErr);
      page.off("console", onCons);
    },
  };
}

async function inspect(page: Page, name: string, role: string, vp: (typeof VIEWPORTS)[number], w: Watch) {
  const tag = `${vp.w}`;
  const info = await page.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    const overlay = !!portal?.shadowRoot?.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay]");
    const text = document.body?.innerText ?? "";
    return {
      overlay,
      notFound: /could not be found|page not found|^\s*404\b/im.test(text),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  for (const e of new Set(w.errors)) {
    issue(name, tag, role, e.startsWith("5xx") ? "5xx" : e.startsWith("pageerror") ? "page error" : "console error", e);
  }
  if (info.overlay) issue(name, tag, role, "error overlay", "Next error overlay is showing");
  if (info.notFound) issue(name, tag, role, "not found", "page shows a not-found message");
  if (vp.w === 390 && info.overflow > 1) issue(name, tag, role, "overflow", `page is ${info.overflow}px wider than the viewport`);
  await page
    .screenshot({ path: `${OUT}/${role}-${slug(name)}-${vp.w}.png`, fullPage: true })
    .catch(() => {});
}

async function visit(page: Page, path: string, label: string, role: string, after?: (p: Page) => Promise<void>) {
  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.w, height: vp.h });
    const w = watch(page);
    try {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (resp && resp.status() >= 500) w.errors.push(`5xx ${resp.status()} ${path}`);
      await settle(page);
      if (after) await after(page);
    } catch (e) {
      issue(label, `${vp.w}`, role, "navigation", (e as Error).message);
    }
    await inspect(page, label, role, vp, w);
    w.stop();
  }
}

// ---------- login ----------
async function login(browser: Browser, role: Role): Promise<Page> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  // tsx (esbuild) wraps named functions in __name(); the browser doesn't have it.
  await page.evaluateOnNewDocument("window.__name = (f) => f;");
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(page);
  const u = USERS[role];
  const ok1 = await setField(page, /company/i, u.code);
  const ok2 = await setField(page, /mobile|email/i, u.id);
  const ok3 = await setField(page, /password/i, PASSWORD);
  if (!ok1 || !ok2 || !ok3) throw new Error(`login form fields not found (company ${ok1}, id ${ok2}, password ${ok3})`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {}),
    clickText(page, /^(log ?in|sign ?in)/i, "button"),
  ]);
  await settle(page);
  if (page.url().includes("/login")) {
    await page.screenshot({ path: `${OUT}/login-FAIL-${role}.png` }).catch(() => {});
    const msg = await page.evaluate(() => (document.querySelector("[role=alert]")?.textContent ?? document.body.innerText).slice(0, 200));
    throw new Error(`login as ${role} did not leave /login: ${msg}`);
  }
  return page;
}

// ---------- sweep ----------
const MASTER_TABS = ["Vehicle types", "Charge types", "Pumps", "Branches", "Number series", "Settings"];
async function sweep(page: Page, role: Role, extra: { challanId: string | null }) {
  const links = navGroups.flatMap((g) => g.items.map((i) => ({ label: i.label, href: i.href })));
  for (const l of links) await visit(page, l.href, l.label, role);

  await visit(page, "/market-trucks/challans", "Challan register", role);
  if (extra.challanId) {
    await visit(page, `/market-trucks/challans/${extra.challanId}`, "Challan detail", role);
    for (const vp of VIEWPORTS.slice(0, 1)) {
      await page.setViewport({ width: vp.w, height: vp.h });
      const r = await page.evaluate(async (url) => {
        const res = await fetch(url);
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, type: res.headers.get("content-type"), size: buf.length, head: String.fromCharCode(...buf.slice(0, 5)) };
      }, `${BASE}/pdf/challan/${extra.challanId}`);
      if (r.status !== 200 || !r.type?.includes("pdf") || r.head !== "%PDF-" || r.size < 2000)
        issue("Challan PDF", `${vp.w}`, role, r.status >= 500 ? "5xx" : "pdf", `status ${r.status}, ${r.type}, ${r.size} bytes`);
    }
  }

  // truck party edit dialog + hire masters tabs (these need a role with master.edit)
  await visit(page, "/market-trucks/parties", "Truck party edit dialog", role, async (p) => {
    if (await clickText(p, /^edit/i)) {
      await p.waitForSelector("[role=dialog], dialog[open]", { timeout: 8000 }).catch(() => {});
      await sleep(400);
    }
  });
  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.w, height: vp.h });
    const w = watch(page);
    await page.goto(`${BASE}/market-trucks/masters`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await settle(page);
    const tabs = MASTER_TABS.filter((t) => t !== "Settings" || role === "owner");
    for (const t of tabs) {
      if (!(await clickText(page, new RegExp(`^${t}$`, "i")))) {
        issue(`Hire masters / ${t}`, `${vp.w}`, role, "missing tab", `tab "${t}" not found`);
        continue;
      }
      await settle(page);
      await inspect(page, `Hire masters / ${t}`, role, vp, w);
      w.errors.length = 0;
    }
    w.stop();
  }
}

// ---------- owner flow ----------
async function flow(page: Page): Promise<string | null> {
  await page.setViewport({ width: 1440, height: 900 });
  const partyName = `TEST-Owner-${RUN}`;
  const vehicleNo = `MH12TE${RUN.slice(-4)}`;
  const driverName = `TEST-Driver-${RUN}`;
  const mobile = () => `98${Math.floor(10000000 + Math.random() * 89999999)}`;
  let challanId: string | null = null;
  const fail = async (name: string, e: unknown) => {
    step(name, false, (e as Error).message ?? String(e));
    await page.screenshot({ path: `${OUT}/flow-FAIL-${slug(name)}.png`, fullPage: true }).catch(() => {});
  };
  const save = async () => {
    await clickText(page, /^(save|add|create)\b/i, "dialog button, [role=dialog] button, form button");
    await sleep(1500);
    await settle(page);
  };
  // The drawer may not be role=dialog: a visible Save button means the form is still open.
  const dialogOpen = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("button")).some(
        (b) => (b as HTMLElement).offsetParent !== null && /^save\b/i.test((b.textContent ?? "").trim()),
      ),
    );
  // In a table row (the empty state "No … matches "<name>"" also contains the name, so body text isn't enough).
  const inRow = (name: string) =>
    page.evaluate((n) => Array.from(document.querySelectorAll("tr")).some((r) => (r as HTMLElement).innerText.includes(n)), name);
  const formError = () =>
    page.evaluate(() => (document.querySelector("[role=alert]")?.textContent ?? document.querySelector("form .text-danger, form p.text-danger")?.textContent ?? "").slice(0, 200));

  // 1. truck party
  try {
    await page.goto(`${BASE}/market-trucks/parties`, { waitUntil: "domcontentloaded" });
    await settle(page);
    if (!(await clickText(page, /^\+?\s*(add|new)/i))) throw new Error("no Add button");
    await page.waitForSelector("[role=dialog], dialog[open], form", { timeout: 8000 });
    await setField(page, /^name/i, partyName);
    await setField(page, /^mobile/i, mobile());
    await save();
    if (await dialogOpen()) throw new Error(`form still open after save: ${await formError()}`);
    await page.goto(`${BASE}/market-trucks/parties?q=${partyName}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const found = await inRow(partyName);
    step("Create truck party", found, found ? partyName : "saved but not in list");
  } catch (e) {
    await fail("Create truck party", e);
  }

  // 2. vehicle
  try {
    await page.goto(`${BASE}/market-trucks/vehicles`, { waitUntil: "domcontentloaded" });
    await settle(page);
    if (!(await clickText(page, /^\+?\s*(add|new)/i))) throw new Error("no Add button");
    await page.waitForSelector("[role=dialog], dialog[open], form", { timeout: 8000 });
    await setField(page, /vehicle (no|number)/i, vehicleNo);
    await pickFromCombobox(page, /owner/i, partyName).catch(() => false);
    await save();
    if (await dialogOpen()) throw new Error(`form still open after save: ${await formError()}`);
    await page.goto(`${BASE}/market-trucks/vehicles?q=${vehicleNo}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const found = await inRow(vehicleNo);
    step("Create vehicle", found, found ? vehicleNo : "saved but not in list");
  } catch (e) {
    await fail("Create vehicle", e);
  }

  // 3. driver
  try {
    await page.goto(`${BASE}/market-trucks/drivers`, { waitUntil: "domcontentloaded" });
    await settle(page);
    if (!(await clickText(page, /^\+?\s*(add|new)/i))) throw new Error("no Add button");
    await page.waitForSelector("[role=dialog], dialog[open], form", { timeout: 8000 });
    await setField(page, /^name/i, driverName);
    await setField(page, /^mobile/i, mobile());
    await save();
    if (await dialogOpen()) throw new Error(`form still open after save: ${await formError()}`);
    await page.goto(`${BASE}/market-trucks/drivers?q=${driverName}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const found = await inRow(driverName);
    step("Create driver", found, found ? driverName : "saved but not in list");
  } catch (e) {
    await fail("Create driver", e);
  }

  // 3b. branch (the challan needs one; the dev DB has none)
  const branchName = `TEST-Branch-${RUN}`;
  try {
    await page.goto(`${BASE}/market-trucks/masters`, { waitUntil: "domcontentloaded" });
    await settle(page);
    if (!(await clickText(page, /^branches$/i))) throw new Error("no Branches tab");
    await settle(page);
    if (!(await clickText(page, /^\+?\s*add/i))) throw new Error("no Add branch button");
    await sleep(600);
    await setField(page, /^name/i, branchName);
    await save();
    if (await dialogOpen()) throw new Error(`form still open after save: ${await formError()}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page);
    await clickText(page, /^branches$/i);
    await settle(page);
    const found = await inRow(branchName);
    step("Create branch", found, found ? branchName : "saved but not in list");
  } catch (e) {
    await fail("Create branch", e);
  }

  // 4. challan: draft → dispatch
  const rate = 12345;
  try {
    await page.goto(`${BASE}/market-trucks/challans/new`, { waitUntil: "domcontentloaded" });
    await settle(page);
    if (!(await setField(page, /branch/i, branchName))) throw new Error("no branch to pick");
    if (!(await pickFromCombobox(page, /^add lr/i, "19"))) throw new Error("could not pick an LR (no booked LR offered)");
    await pickFromCombobox(page, /vehicle/i, vehicleNo);
    await pickFromCombobox(page, /driver/i, driverName);
    if (!(await setField(page, /hire for the (trip|tonne)|hire rate/i, String(rate)))) throw new Error("no rate field");
    await sleep(500);
    if (!(await clickText(page, /save.*draft|^save$/i, "button"))) throw new Error("no Save draft button");
    await page.waitForFunction(() => /\/market-trucks\/challans\/[0-9a-f-]{36}/.test(location.pathname) || !!document.querySelector("[role=alert]"), { timeout: 20_000 }).catch(() => {});
    const m = page.url().match(/challans\/([0-9a-f-]{36})/);
    if (!m) throw new Error(`draft not saved: ${(await page.evaluate(() => document.querySelector("[role=alert]")?.textContent ?? document.body.innerText.slice(0, 200)))}`);
    challanId = m[1];
    step("Save draft challan", true, challanId);
  } catch (e) {
    await fail("Save draft challan", e);
  }
  if (challanId) {
    try {
      if (!(await clickText(page, /dispatch/i, "button"))) throw new Error("no Dispatch button");
      await sleep(2500);
      await settle(page);
      const status = await page.evaluate(() => document.body.innerText.toLowerCase().includes("dispatched"));
      step("Dispatch challan", status, status ? "" : "page does not show 'dispatched'");
    } catch (e) {
      await fail("Dispatch challan", e);
    }

    // 5. register shows it with the right balance
    try {
      await page.goto(`${BASE}/market-trucks/challans?vehicle=${vehicleNo}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const row = await page.evaluate((id) => {
        const a = document.querySelector(`a[href$="${id}"]`);
        return a?.closest("tr")?.innerText.replace(/\s+/g, " ") ?? null;
      }, challanId);
      if (!row) throw new Error("challan not in register");
      const money = (12345).toLocaleString("en-IN", { minimumFractionDigits: 2 });
      const ok = (row.match(new RegExp(money.replace(".", "\\."), "g")) ?? []).length >= 2 && /dispatched/i.test(row);
      step("Register shows challan with balance = hire", ok, row.slice(0, 200));
    } catch (e) {
      await fail("Register shows challan", e);
    }

    // 6. PDF
    try {
      const r = await page.evaluate(async (url) => {
        const res = await fetch(url);
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, type: res.headers.get("content-type"), size: buf.length, head: String.fromCharCode(...buf.slice(0, 5)) };
      }, `${BASE}/pdf/challan/${challanId}`);
      step("Open challan PDF", r.status === 200 && r.head === "%PDF-" && r.size > 2000, `status ${r.status}, ${r.type}, ${r.size} bytes`);
    } catch (e) {
      await fail("Open challan PDF", e);
    }
  }
  return challanId;
}

// ---------- role check ----------
// Booking staff: CAN see the market-truck masters (they have master.edit), can NOT see the Hire
// settings tab (company.manage) and can NOT edit truck-party bank fields (payee.bank).
async function roleCheck(page: Page) {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const nav = await page.evaluate(() => Array.from(document.querySelectorAll("nav a")).map((a) => (a.textContent ?? "").trim()));
  const wanted = ["Truck parties", "Market vehicles", "Market drivers", "Hire masters"];
  const missing = wanted.filter((w) => !nav.some((t) => t.toLowerCase() === w.toLowerCase()));
  step("Staff: sidebar shows the market-truck masters", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");

  await page.goto(`${BASE}/market-trucks/masters`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const view = await page.evaluate((names) => ({
    tabs: Array.from(document.querySelectorAll("main button, main a, [role=tab]"))
      .map((t) => (t.textContent ?? "").trim())
      .filter((t) => names.some((n) => n.toLowerCase() === t.toLowerCase())),
    text: document.body.innerText,
  }), MASTER_TABS);
  step("Staff: Hire masters page opens (not blocked)", view.tabs.length > 0 && !/no access/i.test(view.text), `tabs: ${view.tabs.join(", ") || "none"}`);
  step("Staff: Hire masters has no Settings tab", !view.tabs.some((t) => /settings/i.test(t)), `tabs: ${view.tabs.join(", ") || "none"}`);
  await page.screenshot({ path: `${OUT}/staff-masters-direct.png`, fullPage: true }).catch(() => {});

  await page.goto(`${BASE}/market-trucks/parties`, { waitUntil: "domcontentloaded" });
  await settle(page);
  try {
    if (!(await clickText(page, /^edit/i))) throw new Error("no Edit button on the truck party list");
    await page.waitForSelector("[role=dialog], dialog[open]", { timeout: 8000 });
    await sleep(400);
    const state = await page.evaluate(() => {
      const byLabel = (rx: RegExp) => {
        for (const l of Array.from(document.querySelectorAll("label"))) {
          if (rx.test(l.textContent ?? "")) return (l as HTMLLabelElement).control as HTMLInputElement | null;
        }
        return null;
      };
      const locked = (rx: RegExp) => {
        const c = byLabel(rx);
        return c ? !!(c.readOnly || c.disabled) : null;
      };
      return {
        bankName: locked(/^bank name/i),
        accountNo: locked(/^account number/i),
        ifsc: locked(/^ifsc/i),
        upiId: locked(/^upi id/i),
        verified: locked(/verified/i),
        status: locked(/^status/i),
        notes: locked(/^notes/i),
      };
    });
    const bankLocked = (["bankName", "accountNo", "ifsc", "upiId", "verified", "status"] as const).filter((k) => state[k] !== true);
    step("Staff: truck party bank / UPI / verified / status are read-only", bankLocked.length === 0, bankLocked.length ? `editable: ${bankLocked.join(", ")}` : "");
    step("Staff: truck party notes still editable", state.notes === false, `notes locked = ${state.notes}`);
    await page.screenshot({ path: `${OUT}/staff-party-edit.png`, fullPage: true }).catch(() => {});
  } catch (e) {
    step("Staff: truck party bank fields read-only", false, (e as Error).message);
  }
}

// ---------- main ----------
async function main() {
  mkdirSync(OUT, { recursive: true });
  const exe = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (!exe) throw new Error("Set CHROME_EXECUTABLE_PATH (see .env.local)");
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
  let challanId: string | null = null;
  try {
    for (const role of (process.env.CHECK_ROLES ?? "owner,accountant,staff").split(",") as Role[]) {
      let page: Page;
      try {
        page = await login(browser, role);
        step(`Login as ${role}`, true);
      } catch (e) {
        step(`Login as ${role}`, false, (e as Error).message);
        continue;
      }
      try {
        if (role === "owner") challanId = await flow(page);
        if (role === "staff") await roleCheck(page);
        await sweep(page, role, { challanId });
      } catch (e) {
        issue("(script)", "-", role, "script error", (e as Error).message);
      }
      await page.browserContext().close();
    }
  } finally {
    await browser.close();
  }
  const report = [
    `# Final check — ${new Date().toISOString()}`,
    `Base ${BASE} · run id ${RUN} · test records are prefixed "TEST-"`,
    "",
    "## Flow steps",
    ...steps,
    "",
    `## Issues (${issues.length})`,
    ...(issues.length ? issues : ["- none"]),
    "",
  ].join("\n");
  writeFileSync(`${OUT}/report.md`, report);
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
