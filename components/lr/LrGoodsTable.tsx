"use client";

import { Field, Select } from "@/components/ui/Field";
import { chargedAsLabel } from "@/lib/labels";
import {
  emptyItemRow,
  totalPackages,
  type FormErrors,
  type LrFormValues,
  type LrItemRow,
} from "@/lib/lr-form";
import type { ChargedAs } from "@/lib/types";

const th =
  "border-b border-border px-3 py-2.5 text-left text-[13px] font-semibold text-muted whitespace-nowrap";
const td = "border-b border-border-row px-3 py-2.5 text-sm align-top";

/** Goods rows (said to contain, packages, weight / size) with one "Charged as" for the LR. */
export function LrGoodsTable({
  rows,
  chargedAs,
  onRowsChange,
  onChargedAsChange,
  errors,
}: {
  rows: LrItemRow[];
  chargedAs: LrFormValues["chargedAs"];
  onRowsChange: (rows: LrItemRow[]) => void;
  onChargedAsChange: (value: LrFormValues["chargedAs"]) => void;
  errors: FormErrors;
}) {
  const update = (key: string, patch: Partial<LrItemRow>) =>
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Item (said to contain)</th>
              <th className={th}>Pkgs</th>
              <th className={th}>Weight / size</th>
              <th className={th}>Charged as</th>
              <th className={th}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const err = (f: string) => errors[`items.${i}.${f}`];
              return (
                <tr key={r.key}>
                  <td className={`${td} min-w-56`}>
                    <Field
                      label={`Item ${i + 1}`}
                      hideLabel
                      placeholder="e.g. 500 LTR water tank"
                      value={r.description}
                      onChange={(e) => update(r.key, { description: e.target.value })}
                      error={err("description")}
                    />
                  </td>
                  <td className={`${td} w-24 min-w-20`}>
                    <Field
                      label={`Packages, item ${i + 1}`}
                      hideLabel
                      inputMode="numeric"
                      value={r.packages}
                      onChange={(e) => update(r.key, { packages: e.target.value })}
                      error={err("packages")}
                    />
                  </td>
                  <td className={td}>
                    <div className="flex gap-2">
                      <Field
                        label={`Weight in kg, item ${i + 1}`}
                        hideLabel
                        inputMode="decimal"
                        placeholder="Weight kg"
                        value={r.weight}
                        onChange={(e) => update(r.key, { weight: e.target.value })}
                        error={err("actualWeight")}
                        className="w-28"
                      />
                      <Field
                        label={`Size, item ${i + 1}`}
                        hideLabel
                        placeholder="Size / feet"
                        value={r.size}
                        onChange={(e) => update(r.key, { size: e.target.value })}
                        error={err("size")}
                        className="w-32"
                      />
                    </div>
                  </td>
                  {i === 0 && (
                    <td className={td} rowSpan={rows.length}>
                      <Select
                        label="Charged as"
                        hideLabel
                        value={chargedAs}
                        onChange={(e) => onChargedAsChange(e.target.value as ChargedAs | "")}
                        error={errors.chargedAs}
                        className="w-32"
                      >
                        <option value="">Choose…</option>
                        {(Object.keys(chargedAsLabel) as ChargedAs[]).map((k) => (
                          <option key={k} value={k}>
                            {chargedAsLabel[k]}
                          </option>
                        ))}
                      </Select>
                    </td>
                  )}
                  <td className={`${td} w-12`}>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRowsChange(rows.filter((x) => x.key !== r.key))}
                        aria-label={`Remove item ${i + 1}`}
                        className="inline-flex h-control w-11 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-lg text-muted hover:bg-page hover:text-text"
                      >
                        <span aria-hidden>×</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td className={`${td} font-semibold`}>Total</td>
              <td className={`${td} px-6 font-semibold`}>{totalPackages({ items: rows })}</td>
              <td className={td} />
              <td className={td} />
              <td className={td} />
            </tr>
          </tbody>
        </table>
      </div>
      {errors.items && <p className="mt-2 mb-0 text-[13px] text-danger">{errors.items}</p>}
      <button
        type="button"
        onClick={() => onRowsChange([...rows, emptyItemRow()])}
        className="mt-3 min-h-control cursor-pointer rounded-control border border-dashed border-border-dashed bg-surface px-4 text-sm font-semibold text-primary"
      >
        + Add item
      </button>
    </>
  );
}
