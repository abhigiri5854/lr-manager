import { cx } from "@/lib/cx";
import type { LrDetail } from "@/lib/data/lr-detail";
import { formatDate } from "@/lib/format";

const DAY_MS = 86_400_000;

/** The note under each stage: when it happened, or what it is waiting for. */
function note(step: LrDetail["timeline"][number], d: LrDetail): string {
  const { lr } = d;
  if (lr.status === "Draft") return "—";
  switch (step.stage) {
    case "Draft":
      return "";
    case "Booked":
      return step.at ? formatDate(step.at) : "not booked";
    case "In transit": {
      // The truck is only part of the story once the LR has been dispatched.
      if (!step.at) return "pending";
      const truck = lr.truckNumber ? `truck ${lr.truckNumber}` : null;
      return [formatDate(step.at), truck].filter(Boolean).join(" · ");
    }
    case "Delivered":
      return step.at ? formatDate(step.at) : "pending";
    case "POD received": {
      if (step.at) return formatDate(step.at);
      if (d.podDays === null) return "—";
      if (!lr.deliveredAt) return `due ${d.podDays} days after delivery`;
      const due = new Date(Date.parse(lr.deliveredAt) + d.podDays * DAY_MS).toISOString();
      return `due by ${formatDate(due)}`;
    }
    case "Billed":
      return step.at ? [formatDate(step.at), d.bill?.billNo].filter(Boolean).join(" · ") : "—";
    case "Paid":
      return step.at ? formatDate(step.at) : "—";
  }
}

const state = {
  done: "border-primary bg-primary text-white",
  current: "border-primary bg-surface text-primary",
  upcoming: "border-border-input bg-surface text-muted",
};

const stateWord = { done: " (done)", current: " (next)", upcoming: "" };

/** Booked → … → Paid as six tiles that wrap on narrow screens. */
export function LrTimeline({ detail }: { detail: LrDetail }) {
  return (
    <ol aria-label="Progress" className="m-0 flex list-none flex-wrap gap-2.5 p-0">
      {detail.timeline.map((step) => (
        <li
          key={step.stage}
          aria-current={step.state === "current" ? "step" : undefined}
          className={cx(
            "min-w-[140px] flex-[1_1_140px] rounded-tile border-2 p-3 text-sm leading-[1.4]",
            state[step.state],
          )}
        >
          {step.stage === "Draft" ? (
            <b>Draft — not booked yet</b>
          ) : (
            <>
              <b>{step.stage}</b>
              <span className="sr-only">{stateWord[step.state]}</span>
              <br />
              <span className="text-xs">{note(step, detail)}</span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
