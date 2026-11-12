"use client";

import { useDriver } from "./DriverProvider";
import { card, HomeLink, LangToggle, Screen } from "./ui";

/** A link that is missing, revoked or expired. Hindi first, English under it. */
export function InvalidLink({ company }: { company?: string | null }) {
  const { t, links } = useDriver();
  return (
    <Screen>
      <div className="mb-4 flex justify-end">
        <LangToggle />
      </div>
      <section className={`${card} text-center`}>
        {company ? (
          <p className="text-xl font-semibold">{t("linkClosed", { company })}</p>
        ) : (
          <>
            <p className="text-xl font-semibold">यह लिंक अब चालू नहीं है – ऑफिस को कॉल करें</p>
            <p className="mt-2 text-base text-muted">This link is no longer active – call the office</p>
          </>
        )}
        {links.length > 0 && (
          <div className="mt-4 flex justify-center">
            <HomeLink />
          </div>
        )}
      </section>
    </Screen>
  );
}
