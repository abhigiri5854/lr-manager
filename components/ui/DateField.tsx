"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import {
  addDays,
  addMonths,
  clampDate,
  formatDateTyping,
  isoToDisplay,
  MONTH_NAMES,
  monthWeeks,
  parseDisplayDate,
  weekdayIndex,
} from "@/lib/date-input";
import { control, describedBy, Shell, stateClasses, useFieldIds, type ShellProps } from "./Field";

export type DateFieldProps = ShellProps & {
  /** yyyy-mm-dd, or "" when not set. */
  value: string;
  /** Called with yyyy-mm-dd, or "" while the text is empty or isn't a complete real date. */
  onChange: (value: string) => void;
  /** yyyy-mm-dd limits (inclusive). */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  /** Name for a plain form submit: the hidden field carries the yyyy-mm-dd value. */
  name?: string;
  id?: string;
  autoFocus?: boolean;
  /** Red border without a message (a parent shows the message). */
  invalid?: boolean;
};

/**
 * A DateField whose text isn't a complete real date reports "" to its form, which would look
 * like "no date". Forms call this when saving: it focuses the first such field in `root`
 * (the field then shows why) and returns true, and the save should stop.
 */
export function focusFirstInvalidDate(root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLElement>("[data-invalid-date]");
  el?.focus();
  return !!el;
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const POPOVER_WIDTH = 340;
/** Room the month grid needs: header, weekdays, six weeks, footer. */
const POPOVER_HEIGHT = 420;

/** Viewport position of the open calendar (fixed, so a dialog or card can't clip it). */
type Pos = { left: number; width: number; top?: number; bottom?: number };

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const longDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
};

const navButton =
  "inline-flex h-control w-11 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-lg text-text hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-40";
const textButton =
  "h-control cursor-pointer rounded-control border-0 bg-transparent px-3 text-sm font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-40";

/** Month grid. Arrow keys move by day / week, Home / End to the week's ends, PageUp / PageDown by month (Shift: year). */
function Calendar({
  selected,
  min,
  max,
  required,
  pos,
  onPick,
  onClose,
}: {
  selected: string;
  min?: string;
  max?: string;
  required?: boolean;
  pos: Pos;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const [today] = useState(localToday);
  const [focus, setFocus] = useState(() => clampDate(selected || today, min, max));
  const gridRef = useRef<HTMLDivElement>(null);
  // Keyboard moves in the grid take focus with them; the month / year buttons keep it.
  const focusGrid = useRef(true);

  useEffect(() => {
    if (!focusGrid.current) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus();
  }, [focus]);

  const go = (iso: string, fromGrid: boolean) => {
    focusGrid.current = fromGrid;
    setFocus(clampDate(iso, min, max));
  };

  function onGridKey(e: React.KeyboardEvent) {
    const next: Record<string, string> = {
      ArrowLeft: addDays(focus, -1),
      ArrowRight: addDays(focus, 1),
      ArrowUp: addDays(focus, -7),
      ArrowDown: addDays(focus, 7),
      Home: addDays(focus, -weekdayIndex(focus)),
      End: addDays(focus, 6 - weekdayIndex(focus)),
      PageUp: addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: addMonths(focus, e.shiftKey ? 12 : 1),
    };
    const target = next[e.key];
    if (!target) return;
    e.preventDefault();
    go(target, true);
  }

  const [year, month] = focus.split("-").map(Number) as [number, number];
  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  return (
    <div
      role="dialog"
      aria-label="Choose date"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      style={pos}
      className="fixed z-30 rounded-card border border-border bg-surface p-2 shadow-popover"
    >
      <div className="flex items-center justify-between">
        <div className="flex">
          <button
            type="button"
            className={navButton}
            aria-label="Previous year"
            onClick={() => go(addMonths(focus, -12), false)}
          >
            «
          </button>
          <button
            type="button"
            className={navButton}
            aria-label="Previous month"
            onClick={() => go(addMonths(focus, -1), false)}
          >
            ‹
          </button>
        </div>
        <div aria-live="polite" className="text-sm font-bold">
          {MONTH_NAMES[month - 1]} {year}
        </div>
        <div className="flex">
          <button
            type="button"
            className={navButton}
            aria-label="Next month"
            onClick={() => go(addMonths(focus, 1), false)}
          >
            ›
          </button>
          <button
            type="button"
            className={navButton}
            aria-label="Next year"
            onClick={() => go(addMonths(focus, 12), false)}
          >
            »
          </button>
        </div>
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${MONTH_NAMES[month - 1]} ${year}`}
        onKeyDown={onGridKey}
      >
        <div role="row" className="grid grid-cols-7 text-center text-xs font-semibold text-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} role="columnheader" className="py-1.5">
              {d}
            </div>
          ))}
        </div>
        {monthWeeks(focus).map((week, i) => (
          <div key={i} role="row" className="grid grid-cols-7">
            {week.map((iso, j) =>
              iso ? (
                <div key={iso} role="gridcell" aria-selected={iso === selected}>
                  <button
                    type="button"
                    data-iso={iso}
                    tabIndex={iso === focus ? 0 : -1}
                    disabled={!inRange(iso)}
                    aria-label={longDate(iso)}
                    aria-current={iso === today ? "date" : undefined}
                    onClick={() => onPick(iso)}
                    className={cx(
                      "h-control w-full cursor-pointer rounded-control border text-sm disabled:cursor-not-allowed disabled:text-border-input",
                      iso === selected
                        ? "border-primary bg-primary font-bold text-white"
                        : cx(
                            "bg-surface text-text enabled:hover:bg-primary-soft",
                            iso === today ? "border-primary" : "border-transparent",
                          ),
                    )}
                  >
                    {Number(iso.slice(8))}
                  </button>
                </div>
              ) : (
                <div key={j} role="gridcell" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between">
        <button
          type="button"
          className={textButton}
          disabled={!inRange(today)}
          onClick={() => onPick(today)}
        >
          Today
        </button>
        {!required && (
          <button type="button" className={textButton} onClick={() => onPick("")}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Date input that always shows and accepts dd-mm-yyyy, whatever the browser or OS locale is
 * (it is a text box, not <input type="date">). Typing adds the "-" itself; the calendar
 * button opens a month grid. The value going in and out is yyyy-mm-dd.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  name,
  id,
  autoFocus,
  invalid,
  ...shellProps
}: DateFieldProps) {
  const { controlId, hintId, msgId } = useFieldIds(id);
  const [text, setText] = useState(() => isoToDisplay(value));
  const [lastValue, setLastValue] = useState(value);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const parsed = text ? parseDisplayDate(text) : null;
  // When the value changes from outside (reset, prefill), show it; our own edits already match.
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== (parsed?.ok ? parsed.iso : "")) setText(isoToDisplay(value));
  }

  let ownError: string | null = null;
  if (parsed && !parsed.ok) {
    if (touched || text.length >= 10) ownError = parsed.error;
  } else if (parsed?.ok) {
    if (min && parsed.iso < min) ownError = `Must be on or after ${isoToDisplay(min)}`;
    else if (max && parsed.iso > max) ownError = `Must be on or before ${isoToDisplay(max)}`;
  }
  const error = ownError ?? shellProps.error;
  const shell = { ...shellProps, error };

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    // The calendar is fixed to the screen, so it would drift off the field when anything moves.
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function edit(raw: string) {
    const next = formatDateTyping(raw, text);
    setText(next);
    const p = next ? parseDisplayDate(next) : null;
    const iso = p?.ok ? p.iso : "";
    if (iso !== value) onChange(iso);
  }

  function pick(iso: string) {
    setText(isoToDisplay(iso));
    setTouched(true);
    if (iso !== value) onChange(iso);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function toggle() {
    if (open) return setOpen(false);
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 32);
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
    const below = window.innerHeight - rect.bottom;
    const flip = below < POPOVER_HEIGHT && rect.top > below;
    setPos(
      flip
        ? { left, width, bottom: window.innerHeight - rect.top + 4 }
        : { left, width, top: rect.bottom + 4 },
    );
    setOpen(true);
  }

  const label = typeof shellProps.label === "string" ? shellProps.label : "date";

  return (
    <Shell {...shell} controlId={controlId} hintId={hintId} msgId={msgId}>
      <div ref={wrapRef} className="relative">
        <input
          id={controlId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd-mm-yyyy"
          maxLength={10}
          value={text}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => setTouched(true)}
          data-invalid-date={parsed && !parsed.ok ? "" : undefined}
          aria-invalid={error || invalid ? true : undefined}
          aria-describedby={describedBy(shell, hintId, msgId)}
          className={cx(
            control,
            "h-control pr-11",
            stateClasses(error || invalid, shellProps.aiFlag),
          )}
        />
        {name && <input type="hidden" name={name} value={value} />}
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          aria-label={`Choose ${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className="absolute top-0 right-0 inline-flex h-control w-11 cursor-pointer items-center justify-center rounded-r-control border-0 bg-transparent text-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <rect
              x="3"
              y="4.5"
              width="14"
              height="12.5"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M3 8.5h14M7 2.5v3M13 2.5v3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {open && pos && (
          <Calendar
            selected={parsed?.ok ? parsed.iso : ""}
            min={min}
            max={max}
            required={required}
            pos={pos}
            onPick={pick}
            onClose={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
          />
        )}
      </div>
    </Shell>
  );
}
