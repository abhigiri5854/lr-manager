import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "@/lib/cx";

/*
 * Form controls. Each one renders its own <label>, so a control can't exist
 * without one. Styles from the <style> blocks in NewLR / POD / Settings:
 * label 13px semibold #374151, 6px gap; control ≥44px, 12px side padding,
 * 1px input border, 8px radius, 14px text.
 *
 * AI flag (Import / Invoice): "low-confidence" = 1px orange border,
 * "new-record" = 2px orange border; both on a pale orange background.
 */

export type AiFlag = "low-confidence" | "new-record";

export type ShellProps = {
  label: ReactNode;
  /** Visually hide the label (still read by screen readers), e.g. inside a table cell. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  aiFlag?: AiFlag;
  /** Explains the AI flag, shown under the control in amber. */
  aiNote?: ReactNode;
  className?: string;
};

export const control =
  "w-full rounded-control border bg-surface px-3 text-sm text-text disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted";

export function stateClasses(error: ReactNode, aiFlag: AiFlag | undefined) {
  if (error) return "border-danger";
  if (aiFlag === "new-record") return "border-2 border-attention bg-attention-soft";
  if (aiFlag === "low-confidence") return "border-attention bg-attention-soft";
  return "border-border-input";
}

export function useFieldIds(id: string | undefined) {
  const auto = useId();
  const controlId = id ?? auto;
  return { controlId, hintId: `${controlId}-hint`, msgId: `${controlId}-msg` };
}

export function Shell({
  label,
  hideLabel,
  hint,
  error,
  aiFlag,
  aiNote,
  className,
  controlId,
  hintId,
  msgId,
  children,
}: ShellProps & { controlId: string; hintId: string; msgId: string; children: ReactNode }) {
  return (
    <div className={cx("min-w-0", className)}>
      <label
        htmlFor={controlId}
        className={cx("mb-1.5 block text-[13px] font-semibold text-label", hideLabel && "sr-only")}
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <div id={hintId} className="mt-1.5 text-[13px] text-muted">
          {hint}
        </div>
      )}
      {error ? (
        <div id={msgId} className="mt-1.5 text-[13px] text-danger">
          {error}
        </div>
      ) : (
        aiFlag &&
        aiNote && (
          <div id={msgId} className="mt-2 text-[13px] leading-normal text-warning">
            {aiNote}
          </div>
        )
      )}
    </div>
  );
}

export function describedBy(p: ShellProps, hintId: string, msgId: string) {
  const ids = [p.hint && !p.error && hintId, (p.error || (p.aiFlag && p.aiNote)) && msgId];
  return ids.filter(Boolean).join(" ") || undefined;
}

function splitShellProps<T extends ShellProps>(props: T) {
  const { label, hideLabel, hint, error, aiFlag, aiNote, className, ...rest } = props;
  return { shell: { label, hideLabel, hint, error, aiFlag, aiNote, className }, rest };
}

/** Text input with label. */
export function Field(
  props: ShellProps & Omit<InputHTMLAttributes<HTMLInputElement>, "className">,
) {
  const { shell, rest } = splitShellProps(props);
  const { controlId, hintId, msgId } = useFieldIds(rest.id);
  return (
    <Shell {...shell} controlId={controlId} hintId={hintId} msgId={msgId}>
      <input
        {...rest}
        id={controlId}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(shell, hintId, msgId)}
        className={cx(control, "h-control", stateClasses(shell.error, shell.aiFlag))}
      />
    </Shell>
  );
}

/** Native select with label. Pass <option> children. */
export function Select(
  props: ShellProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">,
) {
  const { shell, rest } = splitShellProps(props);
  const { controlId, hintId, msgId } = useFieldIds(rest.id);
  return (
    <Shell {...shell} controlId={controlId} hintId={hintId} msgId={msgId}>
      <select
        {...rest}
        id={controlId}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(shell, hintId, msgId)}
        className={cx(control, "h-control", stateClasses(shell.error, shell.aiFlag))}
      />
    </Shell>
  );
}

/** Multi-line text with label. Grows from 44px; 10px vertical padding (POD / Settings). */
export function Textarea(
  props: ShellProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">,
) {
  const { shell, rest } = splitShellProps(props);
  const { controlId, hintId, msgId } = useFieldIds(rest.id);
  return (
    <Shell {...shell} controlId={controlId} hintId={hintId} msgId={msgId}>
      <textarea
        rows={2}
        {...rest}
        id={controlId}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(shell, hintId, msgId)}
        className={cx(
          control,
          "block min-h-control py-2.5",
          stateClasses(shell.error, shell.aiFlag),
        )}
      />
    </Shell>
  );
}
