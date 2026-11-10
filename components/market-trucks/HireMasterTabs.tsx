import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { Branch, ChargeType, HireNumberSeries, Pump, VehicleType } from "@/lib/types";
import {
  AddLatePodFeeButton,
  BranchButton,
  ChargeTypeButton,
  PumpButton,
  SeriesButton,
  VehicleTypeButton,
} from "./HireMasterButtons";

const BASE = "/market-trucks/masters";

export const MASTER_TABS = [
  { key: "vehicle-types", label: "Vehicle types" },
  { key: "charge-types", label: "Charge types" },
  { key: "pumps", label: "Pumps" },
  { key: "branches", label: "Branches" },
  { key: "series", label: "Number series" },
  { key: "settings", label: "Settings" },
] as const;
export type MasterTab = (typeof MASTER_TABS)[number]["key"];

export function parseMasterTab(raw: string | string[] | undefined): MasterTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return MASTER_TABS.find((t) => t.key === v)?.key ?? "vehicle-types";
}

export function MasterTabNav({ active, showSettings = false }: { active: MasterTab; showSettings?: boolean }) {
  return (
    <nav aria-label="Hire masters" className="mb-4 flex flex-wrap gap-2">
      {MASTER_TABS.filter((t) => showSettings || t.key !== "settings").map((t) => (
        <Link
          key={t.key}
          href={`${BASE}?tab=${t.key}`}
          aria-current={t.key === active ? "page" : undefined}
          className={
            t.key === active
              ? "inline-flex min-h-control items-center rounded-control bg-primary-soft px-4 text-sm font-semibold text-primary"
              : "inline-flex min-h-control items-center rounded-control border border-border bg-surface px-4 text-sm text-muted"
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function Panel<T>({
  action,
  label,
  columns,
  rows,
  rowKey,
  empty,
}: {
  action: React.ReactNode;
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  empty: React.ReactNode;
}) {
  return (
    <>
      <div className="mb-4 flex justify-end">{action}</div>
      <Card padding="table">
        <DataTable label={label} columns={columns} rows={rows} rowKey={rowKey} empty={empty} />
      </Card>
    </>
  );
}

const yesNo = (v: boolean) => (v ? "Yes" : "—");

export function VehicleTypesTab({ rows }: { rows: VehicleType[] }) {
  const columns: Column<VehicleType>[] = [
    { key: "name", header: "Name", cell: (r) => r.name, wrap: true, sticky: true },
    { key: "cap", header: "Capacity (kg)", cell: (r) => r.capacityKg?.toLocaleString("en-IN") ?? "—" },
    { key: "active", header: "Status", cell: (r) => <Chip tone={r.active ? "green" : "grey"}>{r.active ? "Active" : "Inactive"}</Chip> },
    { key: "edit", header: "", cell: (r) => <VehicleTypeButton row={r} />, align: "right" },
  ];
  return (
    <Panel
      action={<VehicleTypeButton />}
      label="Vehicle types"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      empty="No vehicle types yet. Use + Add vehicle type."
    />
  );
}

export function ChargeTypesTab({ rows }: { rows: ChargeType[] }) {
  const columns: Column<ChargeType>[] = [
    { key: "code", header: "Code", cell: (r) => r.code, mono: true, sticky: true },
    { key: "label", header: "Label", cell: (r) => r.label, wrap: true },
    { key: "dir", header: "Direction", cell: (r) => (r.defaultDirection === "add" ? "Add" : "Deduct") },
    { key: "bill", header: "Bill party", cell: (r) => yesNo(r.defaultBillParty) },
    { key: "stage", header: "Stage", cell: (r) => (r.stage === "hire" ? "Hire" : "POD") },
    { key: "active", header: "Status", cell: (r) => <Chip tone={r.active ? "green" : "grey"}>{r.active ? "Active" : "Inactive"}</Chip> },
    { key: "edit", header: "", cell: (r) => <ChargeTypeButton row={r} />, align: "right" },
  ];
  return (
    <Panel
      action={<ChargeTypeButton />}
      label="Charge types"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      empty={
        <div className="flex flex-col items-center gap-3 py-2">
          <span>No charge types yet.</span>
          <AddLatePodFeeButton />
        </div>
      }
    />
  );
}

export function PumpsTab({ rows }: { rows: Pump[] }) {
  const columns: Column<Pump>[] = [
    { key: "name", header: "Name", cell: (r) => r.name, wrap: true, sticky: true },
    { key: "loc", header: "Location", cell: (r) => r.location ?? "—", wrap: true },
    { key: "ledger", header: "Ledger account", cell: (r) => r.ledgerRef ?? "—", wrap: true },
    { key: "edit", header: "", cell: (r) => <PumpButton row={r} />, align: "right" },
  ];
  return (
    <Panel
      action={<PumpButton />}
      label="Pumps"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      empty="No pumps yet. Use + Add pump."
    />
  );
}

export function BranchesTab({ rows }: { rows: Branch[] }) {
  const columns: Column<Branch>[] = [
    { key: "name", header: "Name", cell: (r) => r.name, wrap: true, sticky: true },
    { key: "code", header: "Code", cell: (r) => r.code ?? "—", mono: true },
    { key: "addr", header: "Address", cell: (r) => r.address ?? "—", wrap: true },
    { key: "edit", header: "", cell: (r) => <BranchButton row={r} />, align: "right" },
  ];
  return (
    <Panel
      action={<BranchButton />}
      label="Branches"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      empty="No branches yet. Use + Add branch."
    />
  );
}

/** Example of the next number, e.g. "CH/26-27/0007". */
function nextExample(s: HireNumberSeries) {
  return `${s.prefix}${String(s.nextNo).padStart(s.padding, "0")}`;
}

export function SeriesTab({ rows, branches }: { rows: HireNumberSeries[]; branches: Branch[] }) {
  const options = branches.map((b) => ({ id: b.id, name: b.name }));
  const columns: Column<HireNumberSeries>[] = [
    { key: "doc", header: "Document", cell: (r) => (r.docType === "challan" ? "Challan" : "Truck payment"), sticky: true },
    { key: "branch", header: "Branch", cell: (r) => r.branchName, wrap: true },
    { key: "fy", header: "FY", cell: (r) => r.fy, mono: true },
    { key: "prefix", header: "Prefix", cell: (r) => r.prefix || "—", mono: true },
    { key: "next", header: "Next number", cell: (r) => r.nextNo },
    { key: "pad", header: "Padding", cell: (r) => r.padding },
    { key: "ex", header: "Next will be", cell: (r) => nextExample(r), mono: true },
    { key: "edit", header: "", cell: (r) => <SeriesButton row={r} />, align: "right" },
  ];
  return (
    <Panel
      action={<SeriesButton branches={options} />}
      label="Number series"
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.docType}|${r.branchId}|${r.fy}`}
      empty={
        branches.length === 0
          ? "Add a branch first, then create its number series."
          : "No number series yet. Use + Add number series."
      }
    />
  );
}
