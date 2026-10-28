import { cx } from "@/lib/cx";

const STEPS = ["Upload", "Read & map", "Review", "Import"];

/**
 * Upload → Read & map → Review → Import (Import.dc.html). `done` = how many steps are finished
 * (see stepsDone in lib/import/labels.ts); the next one is shown in blue.
 */
export function ImportSteps({ done }: { done: number }) {
  return (
    <ol
      aria-label="Import steps"
      className="m-0 grid list-none grid-cols-2 gap-2 p-0 text-sm sm:grid-cols-4"
    >
      {STEPS.map((label, i) => {
        const finished = i < done;
        const current = i === done;
        return (
          <li
            key={label}
            aria-current={current ? "step" : undefined}
            className={cx(
              "rounded-tile px-3.5 py-3 font-semibold",
              finished && "bg-success-soft text-success",
              current && "bg-primary text-white",
              !finished && !current && "border border-border bg-surface text-muted",
            )}
          >
            {i + 1} · {label}
            {finished && " ✓"}
          </li>
        );
      })}
    </ol>
  );
}
