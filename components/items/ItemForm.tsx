"use client";

import { useState, useTransition } from "react";
import { saveItemAction } from "@/app/(app)/items/actions";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { formatPaise, parseRupees } from "@/lib/format";
import { formatGstRate, GST_RATES_BP } from "@/lib/gst";
import { tidyRupees } from "@/lib/lr-form";
import type { Item } from "@/lib/types";

/** Add / edit an item master row, inside a Dialog. `initialName` prefills a new item. */
export function ItemForm({
  item,
  initialName = "",
  onDone,
}: {
  /** Omit to add a new item. */
  item?: Item;
  initialName?: string;
  onDone: (saved?: Item) => void;
}) {
  const [code, setCode] = useState(item?.code ?? "");
  const [name, setName] = useState(item?.name ?? initialName);
  const [hsn, setHsn] = useState(item?.hsn ?? "");
  const [uom, setUom] = useState(item?.uom ?? "");
  const [gst, setGst] = useState(item?.gstRateBp == null ? "" : String(item.gstRateBp));
  const [rate, setRate] = useState(
    item?.lastRatePaise == null ? "" : formatPaise(item.lastRatePaise),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit() {
    const ratePaise = parseRupees(rate);
    if (ratePaise === undefined) {
      return setErrors({ lastRatePaise: "Enter an amount like 4,030.04" });
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveItemAction({
        id: item?.id,
        expectedVersion: item?.version,
        input: {
          code,
          name,
          hsn,
          uom,
          gstRateBp: gst === "" ? null : Number(gst),
          lastRatePaise: ratePaise,
        },
      });
      if (result.ok) return onDone(result.item);
      if (result.kind === "validation") {
        setErrors(Object.fromEntries(result.issues.map((i) => [i.path || "form", i.message])));
      } else {
        setErrors({ form: result.message });
      }
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        // Also used inside the invoice form: don't submit that one.
        e.stopPropagation();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Item code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters"
          className="[&_input]:font-mono"
          error={errors.code}
        />
        <Field
          label="Name / description"
          name="name"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="HSN"
          name="hsn"
          inputMode="numeric"
          hint="4–8 digits"
          value={hsn}
          onChange={(e) => setHsn(e.target.value)}
          error={errors.hsn}
        />
        <Field
          label="UOM"
          name="uom"
          placeholder="EA, KG, MTR"
          value={uom}
          onChange={(e) => setUom(e.target.value)}
          error={errors.uom}
        />
        <Select
          label="GST rate"
          name="gstRateBp"
          value={gst}
          onChange={(e) => setGst(e.target.value)}
          error={errors.gstRateBp}
        >
          <option value="">Not set</option>
          {GST_RATES_BP.map((bp) => (
            <option key={bp} value={bp}>
              {formatGstRate(bp)}
            </option>
          ))}
        </Select>
      </div>
      <Field
        label="Last rate ₹"
        name="lastRatePaise"
        inputMode="decimal"
        hint="Fills new invoice lines; updated when an invoice is finalised"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        onBlur={(e) => setRate(tidyRupees(e.target.value))}
        error={errors.lastRatePaise}
      />
      {errors.form && (
        <p role="alert" className="m-0 text-sm text-danger">
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={() => onDone()} disabled={pending}>
          Close
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : item ? "Save item" : "Add item"}
        </Button>
      </div>
    </form>
  );
}
