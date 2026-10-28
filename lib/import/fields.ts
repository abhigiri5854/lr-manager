// The system fields an Excel column can be saved into (the "Saved into" select of the mapping
// table). Keys are what saved mappings and batches store, so don't rename them.

export const SKIP_FIELD = "skip";

export type ImportField = { key: string; label: string };

export const EXCEL_FIELDS: ImportField[] = [
  { key: "lr_no", label: "LR → LR number" },
  { key: "lr_date", label: "LR → date" },
  { key: "from_place", label: "LR → from" },
  { key: "to_place", label: "LR → to" },
  { key: "consignor_name", label: "Parties → consignor name" },
  { key: "consignor_gstin", label: "Parties → consignor GSTIN" },
  { key: "consignee_name", label: "Parties → consignee name" },
  { key: "consignee_gstin", label: "Parties → consignee GSTIN" },
  { key: "invoice_no", label: "Tax invoice → number" },
  { key: "vehicle_no", label: "Trucks → number" },
  { key: "driver_mobile", label: "Trucks → driver mobile" },
  { key: "packages", label: "LR → packages" },
  { key: "goods", label: "LR → goods description" },
  { key: "billing_weight", label: "LR → billing weight" },
  { key: "actual_weight", label: "LR → actual weight" },
  { key: "rate", label: "LR charges → rate" },
  { key: "freight", label: "LR charges → freight" },
  { key: "remarks", label: "LR → remarks" },
  { key: SKIP_FIELD, label: "Don't import" },
];

export const fieldLabel = (key: string): string =>
  EXCEL_FIELDS.find((f) => f.key === key)?.label ?? "Don't import";

export const isFieldKey = (key: string): boolean => EXCEL_FIELDS.some((f) => f.key === key);
