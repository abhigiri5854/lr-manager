"use client";

import { useState } from "react";
import { searchItemsAction } from "@/app/(app)/items/actions";
import { ItemForm } from "@/components/items/ItemForm";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import { amountInWords, formatPaise } from "@/lib/format";
import { formatGstRate, GST_RATES_BP } from "@/lib/gst";
import { emptyLine, lineFromItem, type InvoiceLineRow } from "@/lib/invoice-form";
import { tidyRupees } from "@/lib/lr-form";
import type { InvoiceLineTax } from "@/lib/tax";
import type { Item, TaxInvoiceTotals } from "@/lib/types";

const th =
  "border-b border-border px-2.5 py-2.5 text-left text-[13px] font-semibold text-muted whitespace-nowrap";
const td = "border-b border-border-row p-2.5 text-sm whitespace-nowrap";
const tdEdit = "border-b border-border-row p-2 text-sm align-top";
const num = "text-right tabular-nums";

/** "SGST 9%" when every line has the same rate, else just "SGST". */
function taxHeader(name: string, rates: number[], share: number) {
  const unique = [...new Set(rates)];
  return unique.length === 1 ? `${name} ${formatGstRate(unique[0] * share)}` : name;
}

function TotalsBox({ totals, intraState }: { totals: TaxInvoiceTotals; intraState: boolean }) {
  const row = "flex justify-between gap-4";
  return (
    <div className="mt-4 flex justify-end">
      <div className="flex w-full max-w-[340px] flex-col gap-2 text-sm">
        <div className={row}>
          <span>Total assessable / taxable</span>
          <b className="tabular-nums">{formatPaise(totals.taxablePaise)}</b>
        </div>
        {intraState ? (
          <>
            <div className={row}>
              <span>SGST</span>
              <b className="tabular-nums">{formatPaise(totals.sgstPaise)}</b>
            </div>
            <div className={row}>
              <span>CGST</span>
              <b className="tabular-nums">{formatPaise(totals.cgstPaise)}</b>
            </div>
          </>
        ) : (
          <div className={row}>
            <span>IGST</span>
            <b className="tabular-nums">{formatPaise(totals.igstPaise)}</b>
          </div>
        )}
        {totals.roundOffPaise !== 0 && (
          <div className={row}>
            <span>Round off</span>
            <b className="tabular-nums">
              {totals.roundOffPaise > 0 ? "+" : "−"}
              {formatPaise(Math.abs(totals.roundOffPaise))}
            </b>
          </div>
        )}
        <div className={`${row} border-t border-border pt-2 text-[18px]`}>
          <span>Invoice total</span>
          <b className="tabular-nums">₹ {formatPaise(totals.totalPaise)}</b>
        </div>
        <div className="text-xs text-muted">{amountInWords(totals.totalPaise)}</div>
        <div className="text-xs text-muted">
          Tax is calculated and rounded line by line
          {totals.roundOffPaise !== 0 ? "; the total is rounded to the nearest rupee." : "."}
        </div>
      </div>
    </div>
  );
}

/** Invoice lines: editable rows with item autocomplete, or plain cells once locked. */
export function InvoiceItemsTable({
  rows,
  onChange,
  taxes,
  totals,
  intraState,
  readOnly,
  errors,
}: {
  rows: InvoiceLineRow[];
  onChange: (rows: InvoiceLineRow[]) => void;
  /** Per row, null while the row is incomplete. */
  taxes: Array<InvoiceLineTax | null>;
  totals: TaxInvoiceTotals;
  intraState: boolean;
  readOnly: boolean;
  errors: Record<string, string>;
}) {
  const [adding, setAdding] = useState<{ key: string; text: string } | null>(null);
  const update = (key: string, patch: Partial<InvoiceLineRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pickItem = (key: string, item: Item) =>
    onChange(rows.map((r) => (r.key === key ? lineFromItem(r, item) : r)));

  const rates = rows.filter((r) => r.gstRateBp !== "").map((r) => Number(r.gstRateBp));
  const taxCols = intraState
    ? [taxHeader("SGST", rates, 0.5), taxHeader("CGST", rates, 0.5)]
    : [taxHeader("IGST", rates, 1)];
  const money = (p: number | undefined) => (p === undefined ? "—" : formatPaise(p));
  const lineTax = (t: InvoiceLineTax | null) =>
    intraState ? [t?.sgstPaise, t?.cgstPaise] : [t?.igstPaise];

  return (
    <>
      {/* Grows while an item list is open so the dropdown isn't clipped by the scroll box. */}
      <div className="relative overflow-x-auto has-[[aria-expanded=true]]:pb-80">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>#</th>
              <th className={th}>Item code</th>
              <th className={th}>Description</th>
              <th className={th}>HSN</th>
              <th className={th}>UOM</th>
              <th className={th}>Qty</th>
              <th className={th}>Rate ₹</th>
              <th className={th}>Discount</th>
              {!readOnly && <th className={th}>GST %</th>}
              <th className={th}>Assessable ₹</th>
              {taxCols.map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
              {!readOnly && (
                <th className={th}>
                  <span className="sr-only">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const t = taxes[i];
              const err = (f: string) => errors[`lines.${i}.${f}`];
              if (readOnly) {
                return (
                  <tr key={r.key}>
                    <td className={td}>{i + 1}</td>
                    <td className={`${td} font-mono`}>{r.itemCode || "—"}</td>
                    <td className={td}>{r.description}</td>
                    <td className={td}>{r.hsn || "—"}</td>
                    <td className={td}>{r.uom || "—"}</td>
                    <td className={`${td} ${num}`}>{r.qty}</td>
                    <td className={`${td} ${num}`}>{r.rate}</td>
                    <td className={`${td} ${num}`}>{r.discount || "0.00"}</td>
                    <td className={`${td} ${num}`}>{money(t?.taxablePaise)}</td>
                    {lineTax(t).map((v, k) => (
                      <td key={k} className={`${td} ${num}`}>
                        {money(v)}
                      </td>
                    ))}
                  </tr>
                );
              }
              return (
                <tr key={r.key}>
                  <td className={`${tdEdit} pt-5`}>{i + 1}</td>
                  <td className={`${tdEdit} min-w-48`}>
                    <Combobox<Item>
                      label={`Item code or name, line ${i + 1}`}
                      hideLabel
                      listLabel="Item master"
                      placeholder="Code or name"
                      selectedText={r.itemCode}
                      loadOptions={searchItemsAction}
                      getKey={(it) => it.id}
                      renderOption={(it) => (
                        <>
                          <b>{it.name}</b>
                          <br />
                          <span className="text-muted">
                            {[
                              it.code && <span className="font-mono">{it.code}</span>,
                              it.hsn && `HSN ${it.hsn}`,
                              it.gstRateBp != null && `GST ${formatGstRate(it.gstRateBp)}`,
                              it.lastRatePaise != null && `last ₹${formatPaise(it.lastRatePaise)}`,
                            ]
                              .filter(Boolean)
                              .map((x, k) => (
                                <span key={k}>
                                  {k > 0 && " · "}
                                  {x}
                                </span>
                              ))}
                          </span>
                        </>
                      )}
                      onPick={(it) => pickItem(r.key, it)}
                      onClear={() => update(r.key, { itemId: null, itemCode: "" })}
                      addNew={{
                        label: "+ Add item to master",
                        onSelect: (q) => setAdding({ key: r.key, text: q }),
                      }}
                      inputClassName="font-mono placeholder:font-sans"
                    />
                  </td>
                  <td className={`${tdEdit} min-w-60`}>
                    <Field
                      label={`Description, line ${i + 1}`}
                      hideLabel
                      value={r.description}
                      onChange={(e) => update(r.key, { description: e.target.value })}
                      error={err("description")}
                    />
                  </td>
                  <td className={`${tdEdit} w-28 min-w-28`}>
                    <Field
                      label={`HSN, line ${i + 1}`}
                      hideLabel
                      inputMode="numeric"
                      value={r.hsn}
                      onChange={(e) => update(r.key, { hsn: e.target.value })}
                      error={err("hsn")}
                    />
                  </td>
                  <td className={`${tdEdit} w-20 min-w-20`}>
                    <Field
                      label={`UOM, line ${i + 1}`}
                      hideLabel
                      value={r.uom}
                      onChange={(e) => update(r.key, { uom: e.target.value })}
                      error={err("uom")}
                    />
                  </td>
                  <td className={`${tdEdit} w-24 min-w-20`}>
                    <Field
                      label={`Quantity, line ${i + 1}`}
                      hideLabel
                      inputMode="decimal"
                      value={r.qty}
                      onChange={(e) => update(r.key, { qty: e.target.value })}
                      error={err("qty")}
                      className="[&_input]:text-right"
                    />
                  </td>
                  <td className={`${tdEdit} w-32 min-w-28`}>
                    <Field
                      label={`Rate in rupees, line ${i + 1}`}
                      hideLabel
                      inputMode="decimal"
                      value={r.rate}
                      onChange={(e) => update(r.key, { rate: e.target.value })}
                      onBlur={(e) => update(r.key, { rate: tidyRupees(e.target.value) })}
                      error={err("ratePaise")}
                      className="[&_input]:text-right"
                    />
                  </td>
                  <td className={`${tdEdit} w-28 min-w-24`}>
                    <Field
                      label={`Discount in rupees, line ${i + 1}`}
                      hideLabel
                      inputMode="decimal"
                      placeholder="0.00"
                      value={r.discount}
                      onChange={(e) => update(r.key, { discount: e.target.value })}
                      onBlur={(e) => update(r.key, { discount: tidyRupees(e.target.value) })}
                      error={err("discountPaise")}
                      className="[&_input]:text-right"
                    />
                  </td>
                  <td className={`${tdEdit} w-24 min-w-24`}>
                    <Select
                      label={`GST rate, line ${i + 1}`}
                      hideLabel
                      value={r.gstRateBp}
                      onChange={(e) => update(r.key, { gstRateBp: e.target.value })}
                      error={err("gstRateBp")}
                    >
                      <option value="">—</option>
                      {GST_RATES_BP.map((bp) => (
                        <option key={bp} value={bp}>
                          {formatGstRate(bp)}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className={`${tdEdit} pt-5 ${num}`}>{money(t?.taxablePaise)}</td>
                  {lineTax(t).map((v, k) => (
                    <td key={k} className={`${tdEdit} pt-5 ${num}`}>
                      {money(v)}
                    </td>
                  ))}
                  <td className={`${tdEdit} w-12`}>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                        aria-label={`Remove line ${i + 1}`}
                        className="inline-flex h-control w-11 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-lg text-muted hover:bg-page hover:text-text"
                      >
                        <span aria-hidden>×</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!readOnly && (
              <tr>
                <td className={td} />
                <td className={td} colSpan={9 + taxCols.length + 1}>
                  <button
                    type="button"
                    onClick={() => onChange([...rows, emptyLine()])}
                    className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-semibold text-primary hover:underline"
                  >
                    + Add item
                  </button>
                  <span className="text-muted">
                    {" "}
                    — type code or name, HSN, GST % and last rate fill from Item master
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {errors.lines && (
        <p role="alert" className="mt-2 mb-0 text-[13px] text-danger">
          {errors.lines}
        </p>
      )}
      <TotalsBox totals={totals} intraState={intraState} />
      <Dialog
        open={adding !== null}
        onClose={() => setAdding(null)}
        title="Add item to master"
        description="Saved to Items, then filled into this line."
      >
        {adding && (
          <ItemForm
            initialName={adding.text}
            onDone={(item) => {
              if (item) pickItem(adding.key, item);
              setAdding(null);
            }}
          />
        )}
      </Dialog>
    </>
  );
}
