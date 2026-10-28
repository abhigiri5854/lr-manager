import { IDS } from "./ids";

/** Mirrors the future number_series table: one row per company + series + financial year. */
export type NumberSeriesRow = {
  companyId: string;
  series: "lr" | "freight_bill";
  fy: string;
  nextValue: number;
};

// 19020 is already used by the draft LR, so the next LR is 19021.
// RS has no LR numbering set yet; freight bill series start at 1 when first used.
export const mockNumberSeries: NumberSeriesRow[] = [
  { companyId: IDS.company.acm, series: "lr", fy: "2026-27", nextValue: 19021 },
];
