"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { cancelLrAction } from "@/app/(app)/lr/actions";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { useCan } from "@/components/ui/Permissions";
import { cx } from "@/lib/cx";

/** Where the open menu sits (fixed, so the table's sideways scroll can't clip it). */
type Position = { top?: number; bottom?: number; right: number };

const MENU_HEIGHT = 160;

const item =
  "block w-full cursor-pointer rounded-control border-0 bg-transparent px-3 py-2.5 text-left text-sm font-normal no-underline outline-none hover:bg-page focus-visible:bg-primary-soft";

/**
 * "⋯" menu for an LR row: Print, Repeat, Cancel LR (asks for a reason first).
 * Keyboard: Enter/Space/↓ open on the first item, ↑ on the last; ↑/↓/Home/End move;
 * Esc closes and returns to the button; Tab closes and moves on.
 */
export function LrRowMenu({
  lrId,
  lrNo,
  canPrint,
  canCancel: cancellable,
}: {
  lrId: string;
  lrNo: string;
  canPrint: boolean;
  /** The LR's status allows cancelling (the role is checked here too). */
  canCancel: boolean;
}) {
  const canRepeat = useCan("lr.edit");
  const canCancel = useCan("record.cancel") && cancellable;
  const menuId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [focusFirst, setFocusFirst] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isOpen = position !== null;

  function open(first: boolean) {
    const r = triggerRef.current!.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    setPosition(
      window.innerHeight - r.bottom > MENU_HEIGHT
        ? { top: r.bottom + 4, right }
        : { bottom: window.innerHeight - r.top + 4, right },
    );
    setFocusFirst(first);
  }

  function close(returnFocus: boolean) {
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // Once open: focus an item, and close on a click elsewhere, scroll or resize.
  useEffect(() => {
    if (!isOpen) return;
    const list = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    (focusFirst ? list[0] : list.at(-1))?.focus();

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setPosition(null);
    };
    const onMove = () => setPosition(null);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [isOpen, focusFirst]);

  function onTriggerKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open(e.key === "ArrowDown");
    }
  }

  function onMenuKeyDown(e: KeyboardEvent) {
    const list = menuItems();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const focus = (n: number) => list[(n + list.length) % list.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focus(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focus(i - 1);
        break;
      case "Home":
        e.preventDefault();
        focus(0);
        break;
      case "End":
        e.preventDefault();
        focus(list.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
      case " ":
        // Space activates links too, like buttons.
        e.preventDefault();
        list[i]?.click();
        break;
    }
  }

  function openCancel() {
    close(false);
    setError(null);
    formRef.current?.reset();
    dialogRef.current?.showModal();
  }

  function submitCancel(form: HTMLFormElement) {
    const reason = String(new FormData(form).get("reason") ?? "");
    startTransition(async () => {
      const result = await cancelLrAction(lrId, reason);
      if (result.ok) dialogRef.current?.close();
      else setError(result.error);
    });
  }

  // Nothing this role can do from the menu → no "⋯" button at all.
  if (!canPrint && !canRepeat && !canCancel) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More actions for LR ${lrNo}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => (isOpen ? close(false) : open(true))}
        onKeyDown={onTriggerKeyDown}
        // 44px target without making the row taller.
        className="-my-3 inline-flex h-control w-11 shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-lg leading-none text-muted hover:bg-page hover:text-text"
      >
        <span aria-hidden>⋯</span>
      </button>

      {position && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`LR ${lrNo}`}
          onKeyDown={onMenuKeyDown}
          style={position}
          className="fixed z-30 min-w-44 rounded-control border border-border bg-surface p-1 shadow-popover"
        >
          {canPrint && (
            <a
              role="menuitem"
              tabIndex={-1}
              href={`/pdf/lr/${lrId}`}
              target="_blank"
              rel="noopener"
              onClick={() => close(false)}
              className={cx(item, "text-text")}
            >
              Print
            </a>
          )}
          {canRepeat && (
            <Link
              role="menuitem"
              tabIndex={-1}
              href={`/lr/new?from=${lrId}`}
              onClick={() => close(false)}
              className={cx(item, "text-text")}
            >
              Repeat
            </Link>
          )}
          {canCancel && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={openCancel}
              className={cx(item, "font-semibold text-danger")}
            >
              Cancel LR…
            </button>
          )}
        </div>
      )}

      {canCancel && (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          onClose={() => triggerRef.current?.focus()}
          className="m-auto w-[min(440px,calc(100vw-32px))] rounded-card border border-border bg-surface p-6 whitespace-normal text-text shadow-popover backdrop:bg-navy/40"
        >
          <form
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              submitCancel(e.currentTarget);
            }}
          >
            <h2 id={titleId} className="m-0 text-[18px] font-bold">
              Cancel LR {lrNo}?
            </h2>
            <p className="mt-2 mb-4 text-sm text-muted">
              It stays in the register as cancelled and its number is not reused.
            </p>
            <Textarea
              label="Reason"
              name="reason"
              required
              minLength={3}
              maxLength={200}
              placeholder="e.g. Booked twice, party cancelled the load"
              error={error}
            />
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
                Keep LR
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? "Cancelling…" : "Cancel LR"}
              </Button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
