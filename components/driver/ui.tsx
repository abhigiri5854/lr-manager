"use client";

// Shared look for the driver app: large text, large tap targets, mobile first.
import Link from "next/link";
import { useDriver } from "./DriverProvider";

export const btn =
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-lg px-5 text-lg font-semibold active:opacity-80 disabled:opacity-50";
export const btnPrimary = `${btn} bg-primary text-white`;
export const btnSoft = `${btn} bg-primary-soft text-primary`;
export const btnOutline = `${btn} border border-border bg-surface text-primary`;
export const card = "rounded-xl border border-border bg-surface p-4";
export const chip = "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium";
export const chipNeutral = `${chip} bg-primary-soft text-primary`;
export const chipWarn = `${chip} bg-warning-soft text-warning`;
export const chipOk = `${chip} bg-success-soft text-success`;
export const input = "min-h-14 w-full rounded-lg border border-border bg-surface px-4 text-lg";

export function Screen({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-xl bg-page px-4 pb-24 pt-4 text-lg text-ink">{children}</main>;
}

export function LangToggle() {
  const { lang, setLang, t } = useDriver();
  return (
    <button type="button" className={`${btnOutline} min-h-11 px-4 text-base`} onClick={() => setLang(lang === "hi" ? "en" : "hi")}>
      {t("switchLang")}
    </button>
  );
}

export function Notices() {
  const { notices, dismissNotice, t } = useDriver();
  return (
    <>
      {notices.map((n) => (
        <div key={n.id} role="status" className={`${chipWarn} mb-3 flex w-full items-center justify-between gap-3 rounded-xl p-4 text-lg`}>
          <span>{t("linkClosed", { company: n.company })}</span>
          <button type="button" className="min-h-11 px-3 text-xl" aria-label="OK" onClick={() => dismissNotice(n.id)}>
            ✕
          </button>
        </div>
      ))}
    </>
  );
}

export function HomeLink() {
  const { t } = useDriver();
  return (
    <Link href="/d" className={btnOutline}>
      {t("home")}
    </Link>
  );
}
