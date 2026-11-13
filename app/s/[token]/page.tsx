import { Suspense } from "react";
import { PrintButton } from "@/components/statement/PrintButton";
import {
  partyStatement,
  TooManyRequestsError,
  type PartyStatement,
} from "@/lib/data/party-statements";
import { formatDate, formatRupees } from "@/lib/format";
import { financialYear, todayInIndia } from "@/lib/fy";
import { toPaise } from "@/lib/hire";
import { statementText, type StatementLang } from "@/lib/statement-text";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const money = (s: string) => formatRupees(toPaise(s));

function fyDates(startYear: number) {
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

const PRINT_CSS = `@media print { body { background: #fff !important; } .no-print { display: none !important; } .stmt-card { break-inside: avoid; } }`;

function Shell({ lang, children }: { lang: StatementLang; children: React.ReactNode }) {
  return (
    <main lang={lang} className="mx-auto min-h-screen max-w-3xl bg-page px-4 py-6 text-text print:bg-white">
      <style>{PRINT_CSS}</style>
      {children}
    </main>
  );
}

function Invalid({ lang, busy }: { lang: StatementLang; busy?: boolean }) {
  const t = statementText[lang];
  return (
    <Shell lang={lang}>
      <section className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="m-0 text-xl font-semibold">{busy ? t.busy : t.invalid}</p>
        {!busy && (
          <p className="mt-2 text-base text-muted">
            {lang === "hi" ? statementText.en.invalid : statementText.hi.invalid}
          </p>
        )}
      </section>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-page p-3 print:border print:border-border">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function Statement({ s, lang, hrefFor, bad, view }: {
  s: PartyStatement;
  lang: StatementLang;
  hrefFor: (q: Record<string, string>) => string;
  bad: boolean;
  view: { p: string; from: string; to: string; thisFy: { from: string; to: string }; prevFy: { from: string; to: string } };
}) {
  const t = statementText[lang];
  const tab = (key: string, label: string, href: string) => (
    <a
      key={key}
      href={href}
      aria-current={view.p === key ? "page" : undefined}
      className={
        view.p === key
          ? "inline-flex min-h-control items-center rounded-control bg-primary-soft px-4 text-sm font-semibold text-primary"
          : "inline-flex min-h-control items-center rounded-control border border-border bg-surface px-4 text-sm text-muted"
      }
    >
      {label}
    </a>
  );
  const phone = s.officePhone?.replace(/[^\d+]/g, "");
  return (
    <Shell lang={lang}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold">{s.partyName}</h1>
          <p className="m-0 mt-0.5 text-sm text-muted">
            {s.companyName} · {t.title}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <a
            href={hrefFor({ lang: lang === "hi" ? "en" : "hi" })}
            className="inline-flex h-control items-center rounded-control border border-border-input bg-surface px-4 font-semibold"
          >
            {t.switchTo}
          </a>
          {phone && (
            <a
              href={`tel:${phone}`}
              className="inline-flex h-control items-center rounded-control bg-primary px-4 font-semibold text-white"
            >
              {t.callOffice}
            </a>
          )}
        </div>
      </header>

      <section className="stmt-card mb-4 rounded-xl border border-border bg-surface p-5 text-center">
        <div className="text-base text-muted">{t.balance}</div>
        <div className="text-4xl font-bold text-text-strong">{money(s.balanceOutstanding)}</div>
        <div className="mt-1 text-[13px] text-muted">{t.balanceNote}</div>
      </section>

      <section className="no-print mb-4 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 text-sm font-semibold">{t.period}</div>
        <div className="mb-3 flex flex-wrap gap-2">
          {tab("fy", t.thisFy, hrefFor({ p: "fy" }))}
          {tab("prev", t.prevFy, hrefFor({ p: "prev" }))}
          {tab("custom", t.custom, hrefFor({ p: "custom", from: view.from, to: view.to }))}
        </div>
        {view.p === "custom" && (
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="p" value="custom" />
            <input type="hidden" name="lang" value={lang} />
            <label className="flex flex-col gap-1 text-sm">
              {t.from}
              <input type="date" name="from" defaultValue={view.from} required className="h-control rounded-control border border-border-input px-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t.to}
              <input type="date" name="to" defaultValue={view.to} required className="h-control rounded-control border border-border-input px-3" />
            </label>
            <button type="submit" className="h-control rounded-control bg-primary px-4 font-semibold text-white">
              {t.show}
            </button>
          </form>
        )}
        {bad && <p role="alert" className="m-0 mt-2 text-[13px] text-warning">{t.badDates}</p>}
      </section>
      <p className="m-0 mb-3 text-sm text-muted">
        {formatDate(s.from)} – {formatDate(s.to)}
      </p>

      <section className="stmt-card mb-4 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 text-sm font-semibold">{t.totals}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label={t.hire} value={money(s.totals.hire)} />
          <Stat label={t.additions} value={money(s.totals.additions)} />
          <Stat label={t.deductions} value={money(s.totals.deductions)} />
          <Stat label={t.tds} value={money(s.totals.tds)} />
          <Stat label={t.paid} value={money(s.totals.paid)} />
          <Stat label={t.balance} value={money(s.totals.balance)} />
        </div>
      </section>

      <h2 className="mb-2 mt-5 text-lg font-semibold">{t.challans}</h2>
      {s.challans.length === 0 ? (
        <p className="text-sm text-muted">{t.noChallans}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {s.challans.map((c) => (
            <li key={c.challanNo} className="stmt-card rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="font-mono">{c.challanNo}</b>
                <span className="text-sm text-muted">{formatDate(c.date)}</span>
              </div>
              <div className="mt-1 text-sm">
                <span className="font-mono">{c.vehicleNo ?? "—"}</span>
                {" · "}
                {[c.source, c.destination].filter(Boolean).join(" → ") || "—"}
              </div>
              <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">{t.hire}</dt>
                <dd className="m-0 text-right">{money(c.hire)}</dd>
                <dt className="text-muted">{t.deductions}</dt>
                <dd className="m-0 text-right">{money(c.deductions)}</dd>
                <dt className="text-muted">{t.tds}</dt>
                <dd className="m-0 text-right">{money(c.tds)}</dd>
                <dt className="text-muted">{t.paid}</dt>
                <dd className="m-0 text-right">{money(c.paid)}</dd>
                <dt className="font-semibold">{t.balance}</dt>
                <dd className="m-0 text-right font-semibold">{money(c.balance)}</dd>
                <dt className="text-muted">{t.podDate}</dt>
                <dd className="m-0 text-right">{c.podReceivedOn ? formatDate(c.podReceivedOn) : t.podPending}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 mt-6 text-lg font-semibold">{t.payments}</h2>
      {s.payments.length === 0 ? (
        <p className="text-sm text-muted">{t.noPayments}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {s.payments.map((p) => (
            <li key={p.voucherNo} className="stmt-card rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="font-mono">{p.voucherNo}</b>
                <span className="text-sm text-muted">{formatDate(p.date)}</span>
              </div>
              <div className="mt-1 text-sm text-muted">
                {t.modes[p.mode] ?? p.mode}
                {p.reference ? ` · ${p.reference}` : ""}
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span>
                  {t.net}: <b>{money(p.net)}</b>
                </span>
                <span>
                  {t.tds}: {money(p.tds)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="no-print mt-6 flex justify-center">
        <PrintButton label={t.download} />
      </div>
    </Shell>
  );
}

async function Loader({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  const { token } = await params;
  const sp = await searchParams;
  const lang: StatementLang = one(sp.lang) === "en" ? "en" : "hi";

  const fyStart = Number(financialYear(todayInIndia()).slice(0, 4));
  const thisFy = fyDates(fyStart);
  const prevFy = fyDates(fyStart - 1);
  const p = ["fy", "prev", "custom"].includes(one(sp.p) ?? "") ? (one(sp.p) as string) : "fy";
  let range = p === "prev" ? prevFy : thisFy;
  if (p === "custom") range = { from: one(sp.from) ?? thisFy.from, to: one(sp.to) ?? thisFy.to };

  const hrefFor = (q: Record<string, string>) => {
    const u = new URLSearchParams();
    const l = q.lang ?? lang;
    if (l === "en") u.set("lang", "en");
    const period = q.p ?? p;
    if (period !== "fy") u.set("p", period);
    if (period === "custom") {
      u.set("from", q.from ?? range.from);
      u.set("to", q.to ?? range.to);
    }
    const s = u.toString();
    return `/s/${encodeURIComponent(token)}${s ? `?${s}` : ""}`;
  };

  let bad = false;
  let statement: PartyStatement | null;
  try {
    try {
      statement = await partyStatement(token, range.from, range.to);
    } catch (e) {
      if (e instanceof TooManyRequestsError) throw e;
      // bad dates are a validation error (token shape / unknown token never reach here as anything else)
      if (e instanceof Error && /date/i.test(e.message)) {
        bad = true;
        range = thisFy;
        statement = await partyStatement(token, range.from, range.to);
      } else throw e;
    }
  } catch (e) {
    return <Invalid lang={lang} busy={e instanceof TooManyRequestsError} />;
  }
  if (!statement) return <Invalid lang={lang} />;
  return (
    <Statement
      s={statement}
      lang={lang}
      hrefFor={hrefFor}
      bad={bad}
      view={{ p: bad ? "fy" : p, from: range.from, to: range.to, thisFy, prevFy }}
    />
  );
}

export default function StatementPage(props: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  return (
    <Suspense fallback={null}>
      <Loader {...props} />
    </Suspense>
  );
}
