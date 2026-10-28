"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type DialogProps = {
  open: boolean;
  /** Called whenever the dialog closes (Esc, or the parent setting open=false). */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
};

/** Modal on the native <dialog> (focus trap, Esc to close). Same look as the "Cancel LR" dialog. */
export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-card border border-border bg-surface p-6 text-text shadow-popover backdrop:bg-navy/40"
    >
      <h2 id={titleId} className="m-0 text-[18px] font-bold">
        {title}
      </h2>
      {description && <p className="mt-2 mb-0 text-sm text-muted">{description}</p>}
      <div className="mt-4">{open && children}</div>
    </dialog>
  );
}
