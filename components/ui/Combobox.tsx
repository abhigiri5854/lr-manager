"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cx } from "@/lib/cx";
import { control, describedBy, Shell, stateClasses, useFieldIds, type ShellProps } from "./Field";

/** A fixed choice shown above the search results, e.g. "Same as consignee". */
export type ComboboxPinned = { key: string; label: ReactNode; onSelect: () => void };

type ComboboxProps<T> = Omit<ShellProps, "aiFlag" | "aiNote"> & {
  id?: string;
  /** Text shown in the box when not typing (the picked option's name). */
  selectedText: string;
  loadOptions: (query: string) => Promise<T[]>;
  getKey: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  onPick: (option: T) => void;
  /** The user emptied the box and left it. */
  onClear?: () => void;
  pinned?: ComboboxPinned[];
  /** "+ Add new party" row at the bottom; gets what was typed. */
  addNew?: { label: string; onSelect: (query: string) => void };
  placeholder?: string;
  /** Accessible name for the list, e.g. "Saved trucks". */
  listLabel: string;
  disabled?: boolean;
  inputClassName?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
};

type Row<T> =
  | { kind: "pinned"; key: string; pinned: ComboboxPinned }
  | { kind: "option"; key: string; option: T }
  | { kind: "add"; key: string };

const DEBOUNCE_MS = 200;

/**
 * Searchable picker (ARIA combobox + listbox). Type to search on the server; ↑/↓/Home/End move,
 * Enter picks, Esc closes and puts the picked value back. Dropdown style from NewLR.dc.html.
 */
export function Combobox<T>(props: ComboboxProps<T>) {
  const {
    label,
    hideLabel,
    hint,
    error,
    className,
    selectedText,
    loadOptions,
    getKey,
    renderOption,
    onPick,
    onClear,
    pinned = [],
    addNew,
    placeholder,
    listLabel,
    disabled,
    inputClassName,
    inputMode,
  } = props;
  const shell = { label, hideLabel, hint, error, className };
  const { controlId, hintId, msgId } = useFieldIds(props.id);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not typing; show selectedText
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const requestRef = useRef(0);
  const loadRef = useRef(loadOptions);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadRef.current = loadOptions;
  }, [loadOptions]);

  const text = query ?? selectedText;
  const searchText = query ?? "";

  // Search as the user types (debounced); stale answers are ignored.
  useEffect(() => {
    if (!open) return;
    const req = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await loadRef.current(searchText.trim());
        if (req === requestRef.current) {
          setOptions(rows);
          setActive(0);
        }
      } finally {
        if (req === requestRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, searchText]);

  const rows: Row<T>[] = [
    // Pinned choices only when not searching for something specific.
    ...(searchText.trim()
      ? []
      : pinned.map((p) => ({ kind: "pinned" as const, key: p.key, pinned: p }))),
    ...options.map((o) => ({ kind: "option" as const, key: getKey(o), option: o })),
    ...(addNew ? [{ kind: "add" as const, key: "__add" }] : []),
  ];
  const activeRow = open ? rows[Math.min(active, rows.length - 1)] : undefined;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function close() {
    setOpen(false);
    setQuery(null);
  }

  function choose(row: Row<T>) {
    const typed = searchText.trim();
    close();
    if (row.kind === "pinned") row.pinned.onSelect();
    else if (row.kind === "option") onPick(row.option);
    else addNew?.onSelect(typed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const move = (n: number) => {
      e.preventDefault();
      if (!open) setOpen(true);
      if (rows.length) setActive((n + rows.length) % rows.length);
    };
    switch (e.key) {
      case "ArrowDown":
        move(open ? active + 1 : 0);
        break;
      case "ArrowUp":
        move(open ? active - 1 : rows.length - 1);
        break;
      case "Home":
        if (open) move(0);
        break;
      case "End":
        if (open) move(rows.length - 1);
        break;
      case "Enter":
        if (open && activeRow) {
          e.preventDefault();
          choose(activeRow);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
    }
  }

  return (
    <Shell {...shell} controlId={controlId} hintId={hintId} msgId={msgId}>
      <div className="relative">
        <input
          id={controlId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow ? optionId(rows.indexOf(activeRow)) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(shell, hintId, msgId)}
          autoComplete="off"
          spellCheck={false}
          inputMode={inputMode}
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            if (query !== null && query.trim() === "" && selectedText) onClear?.();
            close();
          }}
          onKeyDown={onKeyDown}
          className={cx(
            control,
            "h-control",
            open ? "border-2 border-primary px-[11px]" : stateClasses(error, undefined),
            inputClassName,
          )}
        />
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          hidden={!open}
          // Keep focus in the input while clicking a row.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-tile border border-border-input bg-surface p-1.5 text-sm leading-[1.45] shadow-popover"
        >
          {rows.map((row, i) => (
            <div
              key={row.key}
              id={optionId(i)}
              data-index={i}
              role="option"
              aria-selected={activeRow === row}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(row)}
              className={cx(
                "cursor-pointer rounded-[6px] p-2.5",
                activeRow === row && "bg-primary-soft",
                row.kind === "add" && "font-semibold text-primary",
              )}
            >
              {row.kind === "pinned"
                ? row.pinned.label
                : row.kind === "option"
                  ? renderOption(row.option)
                  : `${addNew!.label}${searchText.trim() ? ` “${searchText.trim()}”` : ""}`}
            </div>
          ))}
          {!loading && options.length === 0 && searchText.trim() !== "" && (
            <div className="p-2.5 text-muted" role="presentation">
              No match for “{searchText.trim()}”
            </div>
          )}
          {loading && options.length === 0 && (
            <div className="p-2.5 text-muted" role="presentation">
              Searching…
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
