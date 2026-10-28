import { Card } from "@/components/ui/Card";
import { cx } from "@/lib/cx";
import type { ChecklistLine } from "@/lib/lr-form";

const marks: Record<ChecklistLine["tone"], { mark: string; className: string; sr: string }> = {
  ok: { mark: "✓", className: "", sr: "Done:" },
  warn: { mark: "!", className: "text-warning", sr: "Check:" },
  todo: { mark: "○", className: "text-muted", sr: "To do:" },
};

/** "Before you save" box on the right of the LR form. */
export function LrChecklist({ lines }: { lines: ChecklistLine[] }) {
  return (
    <Card
      title="Before you save" // The design puts 10px under this heading (Card default is 16px).
      className="text-sm leading-[1.6] [&>div:first-child]:mb-2.5"
    >
      <ul className="m-0 list-none p-0" aria-live="polite">
        {lines.map((l) => (
          <li key={l.text} className={cx(marks[l.tone].className)}>
            <span aria-hidden>{marks[l.tone].mark}</span>{" "}
            <span className="sr-only">{marks[l.tone].sr} </span>
            {l.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}
