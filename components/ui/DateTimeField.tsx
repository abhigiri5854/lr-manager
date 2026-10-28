"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { formatTimeTyping, parseTime } from "@/lib/date-input";
import { DateField } from "./DateField";
import { Field } from "./Field";

type DateTimeFieldProps = {
  label: ReactNode;
  /** yyyy-mm-ddThh:mm (24-hour), or "" until both parts are complete and real. */
  value: string;
  onChange: (value: string) => void;
  error?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** Date (dd-mm-yyyy with calendar) plus a 24-hour hh:mm time, for e-way bill expiry. */
export function DateTimeField({
  label,
  value,
  onChange,
  error,
  disabled,
  className,
}: DateTimeFieldProps) {
  const [date, setDate] = useState(value.slice(0, 10));
  const [time, setTime] = useState(value.slice(11, 16));
  const [lastValue, setLastValue] = useState(value);
  const [touched, setTouched] = useState(false);

  const parsedTime = time ? parseTime(time) : null;
  const combine = (d: string, t: string) => {
    const p = t ? parseTime(t) : null;
    return d && p?.ok ? `${d}T${p.time}` : "";
  };

  // When the value changes from outside, show it; our own edits already match.
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== combine(date, time)) {
      setDate(value.slice(0, 10));
      setTime(value.slice(11, 16));
    }
  }

  const emit = (d: string, t: string) => {
    const next = combine(d, t);
    if (next !== value) onChange(next);
  };

  const timeError =
    parsedTime && !parsedTime.ok && (touched || time.length >= 5) ? parsedTime.error : undefined;
  const missing =
    !error && !timeError && ((date && !time) || (!date && time))
      ? "Enter both the date and the time"
      : undefined;
  const message = timeError ?? error ?? missing;

  return (
    <fieldset className={cx("m-0 min-w-0 border-0 p-0", className)} disabled={disabled}>
      <legend className="mb-1.5 p-0 text-[13px] font-semibold text-label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        <DateField
          label="Date"
          hideLabel
          value={date}
          onChange={(d) => {
            setDate(d);
            emit(d, time);
          }}
          invalid={!!(error || missing)}
          className="min-w-36 flex-1"
        />
        <Field
          label="Time (24-hour)"
          hideLabel
          inputMode="numeric"
          placeholder="hh:mm"
          maxLength={5}
          value={time}
          onChange={(e) => {
            const next = formatTimeTyping(e.target.value, time);
            setTime(next);
            emit(date, next);
          }}
          onBlur={() => setTouched(true)}
          data-invalid-date={(parsedTime && !parsedTime.ok) || missing ? "" : undefined}
          className="w-24 shrink-0"
        />
      </div>
      {message && <div className="mt-1.5 text-[13px] text-danger">{message}</div>}
    </fieldset>
  );
}
