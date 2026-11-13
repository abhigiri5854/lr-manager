"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  challanInsightsAction,
  saveChallanAction,
  searchChallanBrokersAction,
  searchChallanDriversAction,
  searchChallanLrsAction,
  searchChallanVehiclesAction,
} from "@/app/(app)/market-trucks/challans/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Combobox } from "@/components/ui/Combobox";
import { DateField } from "@/components/ui/DateField";
import { Field, Select, Textarea } from "@/components/ui/Field";
import {
  challanWarnings,
  rateOutlier,
  tripMargin,
  type ChallanInsights,
} from "@/lib/challan-insights";
import { formatDate, formatRupees } from "@/lib/format";
import { calcChallan, toPaise } from "@/lib/hire";
import type { Branch, ChallanLrPick, ChallanView, ChargeType } from "@/lib/types";
import {
  challanFields,
  challanRuleErrors,
  type ChallanInput,
} from "@/lib/validators/challan";
import { istLocalFromIso } from "@/lib/validators/challan-ewb";
import { QuickAddDriverDrawer } from "./QuickAddDriverDrawer";
import { QuickAddVehicleDrawer } from "./QuickAddVehicleDrawer";

type Line = {
  pick: ChallanLrPick;
  pkgs: string;
  wt: string;
  wtTouched: boolean;
  /** E-way bill: no., generated date (yyyy-mm-dd), valid upto (India time, yyyy-mm-ddThh:mm), km */
  ewbNo: string;
  ewbDate: string;
  ewbValidUpto: string;
  ewbKm: string;
};
type Charge = { key: string; chargeTypeId: string; amount: string; note: string };
type Named = { id: string; name: string };
type VehiclePick = { id: string; vehicleNo: string; ownerName: string | null };

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

/** Weight (kg) for `pkgs` packages: the same share of the free weight as of the free packages. */
function defaultWt(pick: ChallanLrPick, pkgs: string): string {
  const n = Number(pkgs);
  if (pick.remainingWt === null || !n || pick.remainingPkgs <= 0) return "";
  return ((Number(pick.remainingWt) * n) / pick.remainingPkgs).toFixed(3).replace(/\.?0+$/, "");
}

const money = (value: string) => {
  try {
    return formatRupees(toPaise(value));
  } catch {
    return "—";
  }
};

/**
 * Challan create / edit (TIER1-MARKET-TRUCKS.md §6 screen 1): right rail has the margin card and
 * warnings, the rate field a lane-rate hint. Hire totals come from lib/hire; the server recomputes them on save.
 * `challan` set = editing; only a draft can be edited, anything else shows read-only.
 */
export function ChallanForm({
  challan,
  branches,
  chargeTypes,
  initialPicks = [],
  today,
}: {
  challan?: ChallanView;
  branches: Branch[];
  /** Active, hire-stage charge types. */
  chargeTypes: ChargeType[];
  /** The challan's LRs with what is free to load (this challan's own load excluded). */
  initialPicks?: ChallanLrPick[];
  today: string;
}) {
  const router = useRouter();
  const readOnly = !!challan && challan.status !== "draft";
  const pickById = new Map(initialPicks.map((p) => [p.lrId, p]));

  const [branchId, setBranchId] = useState(challan?.branchId ?? branches[0]?.id ?? "");
  const [date, setDate] = useState(challan?.challanDate ?? today);
  const [lines, setLines] = useState<Line[]>(() =>
    (challan?.lrs ?? []).flatMap((l) => {
      const pick = pickById.get(l.lrId);
      return pick
        ? [
            {
              pick,
              pkgs: String(l.loadedPkgs),
              wt: l.loadedWt ?? "",
              wtTouched: true,
              ewbNo: l.ewbNo ?? "",
              ewbDate: l.ewbDate ?? "",
              ewbValidUpto: istLocalFromIso(l.ewbValidUpto),
              ewbKm: l.ewbDistanceKm === null ? "" : String(l.ewbDistanceKm),
            },
          ]
        : [];
    }),
  );
  const [source, setSource] = useState(challan?.source ?? "");
  const [destination, setDestination] = useState(challan?.destination ?? "");
  const [routeTouched, setRouteTouched] = useState(!!challan);
  const [vehicle, setVehicle] = useState<VehiclePick | null>(
    challan?.vehicleId
      ? { id: challan.vehicleId, vehicleNo: challan.vehicleNo ?? "", ownerName: null }
      : null,
  );
  const [driver, setDriver] = useState<Named | null>(
    challan?.driverId ? { id: challan.driverId, name: challan.driverName ?? "" } : null,
  );
  const [broker, setBroker] = useState<Named | null>(
    challan?.brokerId ? { id: challan.brokerId, name: challan.brokerName ?? "" } : null,
  );
  const [payeeKind, setPayeeKind] = useState<"owner" | "broker">(challan?.payeeKind ?? "owner");
  const [rateBasis, setRateBasis] = useState<"trip" | "per_tonne">(challan?.rateBasis ?? "trip");
  const [rate, setRate] = useState(challan && Number(challan.rate) > 0 ? challan.rate : "");
  const [qtyText, setQtyText] = useState(challan?.qtyTonnes ?? "");
  const [qtyTouched, setQtyTouched] = useState(challan?.qtyTonnes != null);
  const [charges, setCharges] = useState<Charge[]>(() =>
    (challan?.charges ?? []).map((c) => ({
      key: nextKey(),
      chargeTypeId: c.chargeTypeId,
      amount: c.amount,
      note: c.note ?? "",
    })),
  );
  const [remarks, setRemarks] = useState(challan?.remarks ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [vehicleDrawer, setVehicleDrawer] = useState<{ open: boolean; no: string }>({
    open: false,
    no: "",
  });
  const [driverDrawer, setDriverDrawer] = useState(false);
  const version = useRef(challan?.version ?? 0);
  const savedId = useRef(challan?.id ?? null);

  // ---------- LRs ----------
  const addedIds = new Set(lines.map((l) => l.pick.lrId));
  const totalKg = lines.reduce((s, l) => s + (Number(l.wt) || 0), 0);
  const defaultQty = totalKg > 0 ? (totalKg / 1000).toFixed(3).replace(/\.?0+$/, "") : "";
  const qty = qtyTouched ? qtyText : defaultQty;

  function changeLines(next: Line[]) {
    setLines(next);
    if (!routeTouched) {
      setSource(next[0]?.pick.fromPlace ?? "");
      setDestination(next[0]?.pick.toPlace ?? "");
    }
  }

  function addLr(pick: ChallanLrPick) {
    if (addedIds.has(pick.lrId)) return;
    if (pick.remainingPkgs <= 0) {
      setErrors((e) => ({
        ...e,
        lrPicker: `LR ${pick.lrNo} is fully loaded on ${pick.onChallanNos.join(", ")}`,
      }));
      return;
    }
    setErrors((e) => {
      const rest = { ...e };
      delete rest.lrPicker;
      return rest;
    });
    const pkgs = String(pick.remainingPkgs);
    changeLines([
      ...lines,
      {
        pick,
        pkgs,
        wt: defaultWt(pick, pkgs),
        wtTouched: false,
        ewbNo: "",
        ewbDate: "",
        ewbValidUpto: "",
        ewbKm: "",
      },
    ]);
  }

  function setLine(i: number, patch: Partial<Line>) {
    changeLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  // ---------- hire ----------
  const chargeTypeById = new Map(chargeTypes.map((t) => [t.id, t]));
  const calc = useMemo(() => {
    try {
      return calcChallan({
        basis: rateBasis,
        rate: rate.trim() || "0",
        tonnes: qty.trim() || null,
        charges: charges.flatMap((c) => {
          const t = chargeTypeById.get(c.chargeTypeId);
          return t && c.amount.trim() ? [{ direction: t.defaultDirection, amount: c.amount.trim() }] : [];
        }),
      });
    } catch {
      return null;
    }
    // chargeTypeById is rebuilt every render from the `chargeTypes` prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateBasis, rate, qty, charges, chargeTypes]);

  const payeeName = payeeKind === "broker" ? (broker?.name ?? null) : (vehicle?.ownerName ?? null);

  // ---------- right rail: margin, lane rate, warnings ----------
  const [insights, setInsights] = useState<ChallanInsights | null>(null);
  const [asOfMs, setAsOfMs] = useState(0); // when the insights were fetched (e-way expiry is judged at that moment)
  const lrIdsKey = lines.map((l) => l.pick.lrId).join(",");
  const vehicleId = vehicle?.id ?? null;
  const driverId = driver?.id ?? null;
  const brokerId = broker?.id ?? null;
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      challanInsightsAction({
        vehicleId,
        driverId,
        brokerId,
        payeeKind,
        source,
        destination,
        rateBasis,
        lrIds: lrIdsKey ? lrIdsKey.split(",") : [],
      })
        .then((r) => {
          if (stale) return;
          setInsights(r);
          setAsOfMs(Date.now());
        })
        .catch(() => {
          if (!stale) setInsights(null);
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [vehicleId, driverId, brokerId, payeeKind, source, destination, rateBasis, lrIdsKey]);

  const freightPaise = lines.reduce((s, l) => {
    const n = Number(l.pkgs) || 0;
    const { freightPaise: f, totalPkgs } = l.pick;
    return s + (totalPkgs > 0 ? Math.round((f * n) / totalPkgs) : f);
  }, 0);
  const grossPaise = calc ? toPaise(calc.hireAmount) + toPaise(calc.additions) : null;
  const margin =
    grossPaise === null || lines.length === 0
      ? null
      : tripMargin(freightPaise, grossPaise, insights?.settings.minMarginPct ?? null);
  const outlier =
    insights?.lane && Number(rate) > 0
      ? rateOutlier(Number(rate), Number(insights.lane.medianRate), insights.settings.rateOutlierPct)
      : null;
  const warnings = challanWarnings(insights, today, asOfMs);

  // ---------- save ----------
  function buildInput(action: "draft" | "dispatch"): ChallanInput {
    return {
      branchId,
      challanDate: date,
      source,
      destination,
      vehicleId: vehicle?.id ?? "",
      driverId: driver?.id ?? "",
      brokerId: broker?.id ?? "",
      payeeKind,
      rateBasis,
      rate: rate.trim() || "0",
      qtyTonnes: qty.trim(),
      remarks,
      lrs: lines.map((l) => ({
        lrId: l.pick.lrId,
        loadedPkgs: l.pkgs,
        loadedWt: l.wt.trim(),
        ewbNo: l.ewbNo.trim(),
        ewbDate: l.ewbDate.trim(),
        ewbValidUpto: l.ewbValidUpto.trim(),
        ewbDistanceKm: l.ewbKm.trim(),
      })),
      charges: charges.map((c) => ({ chargeTypeId: c.chargeTypeId, amount: c.amount, note: c.note })),
      action,
    };
  }

  function save(action: "draft" | "dispatch") {
    const input = buildInput(action);
    const parsed = challanFields.safeParse(input);
    const found: Record<string, string> = {};
    if (!parsed.success)
      for (const i of parsed.error.issues) found[i.path.join(".")] ??= i.message;
    else for (const i of challanRuleErrors(parsed.data)) found[i.path] ??= i.message;
    if (lines.length === 0) found.lrPicker = "Add at least one LR";
    if (Object.keys(found).length) {
      setErrors(found);
      setFormError("Some details need fixing — see the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    setSavedNote(null);
    startTransition(async () => {
      const result = await saveChallanAction(savedId.current, savedId.current ? version.current : null, input);
      if (result.ok) {
        version.current = result.challan.version;
        savedId.current = result.challan.id;
        if (!challan) {
          router.push(`/market-trucks/challans/${result.challan.id}`);
        } else if (action === "dispatch") {
          router.refresh();
        } else {
          setSavedNote(`Draft saved · ${result.challan.challanNo}`);
        }
        return;
      }
      if (result.kind === "conflict") setConflict(true);
      else if (result.kind === "validation") {
        setErrors(Object.fromEntries(result.issues.map((i) => [i.path, i.message])));
        setFormError(
          result.issues.some((i) => !i.path) ? result.message : "Some details need fixing — see the highlighted fields.",
        );
      } else setFormError(result.message);
    });
  }

  const err = (path: string) => errors[path];

  return (
    <>
    <div className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save("draft");
      }}
      className="flex min-w-0 flex-col gap-5"
    >
      {readOnly && (
        <Alert tone="info" title={`This challan is ${challan!.status.replace("_", " ")}.`}>
          Only a draft challan can be edited here.
        </Alert>
      )}
      {conflict && (
        <Alert tone="warning" title="This challan was changed by someone else.">
          Reload the page to see the latest version before saving again.
        </Alert>
      )}

      <fieldset disabled={readOnly || pending} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        <Card title="Challan">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={!!challan}
              error={err("branchId")}
              hint={challan ? "The branch is fixed once the number is allocated." : undefined}
            >
              {branches.length === 0 && <option value="">No branch — add one in Hire masters</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <DateField label="Date" value={date} onChange={setDate} error={err("challanDate")} required />
            <Field
              label="Challan no."
              value={challan?.challanNo ?? ""}
              placeholder="Allocated on save"
              readOnly
              className="[&_input]:font-mono"
              hint={challan ? undefined : "Numbered per branch and financial year when you save."}
            />
          </div>
        </Card>

        <Card title="Loaded LRs" description="Search an LR by number or party and add it. Packages and weight are what goes on this truck.">
          <Combobox<ChallanLrPick>
            label="Add LR"
            listLabel="Booked LRs"
            placeholder="LR no., consignor, consignee, place…"
            selectedText=""
            error={err("lrPicker") ?? err("lrs")}
            loadOptions={(q) => searchChallanLrsAction(q, challan?.id ?? null).then((rows) => rows.filter((r) => !addedIds.has(r.lrId)))}
            getKey={(o) => o.lrId}
            onPick={addLr}
            renderOption={(o) => (
              <div className={o.remainingPkgs <= 0 ? "opacity-60" : undefined}>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <b className="font-mono">{o.lrNo}</b>
                  <span>
                    {o.consignorName ?? "—"} → {o.consigneeName ?? "—"}
                  </span>
                </div>
                <div className="text-[13px] text-muted">
                  {[o.fromPlace, o.toPlace].filter(Boolean).join(" → ")} · {o.remainingPkgs} of {o.totalPkgs} pkgs free
                  {o.onChallanNos.length > 0 && ` · on challan ${o.onChallanNos.join(", ")}`}
                </div>
              </div>
            )}
          />

          {lines.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[13px] text-muted">
                    <th className="py-2 pr-3 font-semibold">LR</th>
                    <th className="py-2 pr-3 font-semibold">Party</th>
                    <th className="w-32 py-2 pr-3 font-semibold">Packages</th>
                    <th className="w-36 py-2 pr-3 font-semibold">Weight (kg)</th>
                    <th className="w-10 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <Fragment key={l.pick.lrId}>
                    <tr className="border-t border-border align-top">
                      <td className="py-2 pr-3">
                        <b className="font-mono">{l.pick.lrNo}</b>
                        <div className="text-[13px] text-muted">
                          {l.pick.lrDate ? formatDate(l.pick.lrDate) : "—"}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {l.pick.consignorName ?? "—"} → {l.pick.consigneeName ?? "—"}
                        <div className="text-[13px] text-muted">
                          {[l.pick.fromPlace, l.pick.toPlace].filter(Boolean).join(" → ")}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Field
                          label={`Packages, ${l.pick.lrNo}`}
                          hideLabel
                          inputMode="numeric"
                          value={l.pkgs}
                          onChange={(e) =>
                            setLine(i, {
                              pkgs: e.target.value,
                              ...(l.wtTouched ? {} : { wt: defaultWt(l.pick, e.target.value) }),
                            })
                          }
                          error={err(`lrs.${i}.loadedPkgs`)}
                          hint={`max ${l.pick.remainingPkgs} of ${l.pick.totalPkgs}`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Field
                          label={`Weight in kg, ${l.pick.lrNo}`}
                          hideLabel
                          inputMode="decimal"
                          value={l.wt}
                          onChange={(e) => setLine(i, { wt: e.target.value, wtTouched: true })}
                          error={err(`lrs.${i}.loadedWt`)}
                          hint={l.pick.remainingWt ? `max ${l.pick.remainingWt}` : undefined}
                        />
                      </td>
                      <td className="py-2">
                        <Button
                          variant="secondary"
                          aria-label={`Remove ${l.pick.lrNo}`}
                          onClick={() => changeLines(lines.filter((_, j) => j !== i))}
                        >
                          ✕
                        </Button>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="pb-3 pr-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                          <Field
                            label={`E-way no., ${l.pick.lrNo}`}
                            inputMode="numeric"
                            maxLength={12}
                            value={l.ewbNo}
                            onChange={(e) => setLine(i, { ewbNo: e.target.value })}
                            error={err(`lrs.${i}.ewbNo`)}
                            hint="Optional"
                          />
                          <Field
                            label="Generated on"
                            type="date"
                            value={l.ewbDate}
                            onChange={(e) => setLine(i, { ewbDate: e.target.value })}
                            error={err(`lrs.${i}.ewbDate`)}
                          />
                          <Field
                            label="Valid upto"
                            type="datetime-local"
                            value={l.ewbValidUpto}
                            onChange={(e) => setLine(i, { ewbValidUpto: e.target.value })}
                            error={err(`lrs.${i}.ewbValidUpto`)}
                            hint="Blank = computed from date + km"
                          />
                          <Field
                            label="Distance (km)"
                            inputMode="numeric"
                            value={l.ewbKm}
                            onChange={(e) => setLine(i, { ewbKm: e.target.value })}
                            error={err(`lrs.${i}.ewbDistanceKm`)}
                          />
                        </div>
                      </td>
                    </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Source"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setRouteTouched(true);
              }}
              error={err("source")}
              hint={routeTouched ? undefined : "Filled from the first LR; you can change it."}
            />
            <Field
              label="Destination"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setRouteTouched(true);
              }}
              error={err("destination")}
            />
          </div>
        </Card>

        <Card title="Truck" description="Type the vehicle number. If it isn't saved yet you can add it here.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Combobox<Awaited<ReturnType<typeof searchChallanVehiclesAction>>[number]>
              label="Vehicle"
              listLabel="Market vehicles"
              placeholder="BR01GN8331"
              selectedText={vehicle?.vehicleNo ?? ""}
              inputClassName="font-mono uppercase"
              error={err("vehicleId")}
              loadOptions={(q) => searchChallanVehiclesAction(q)}
              getKey={(o) => o.id}
              onPick={(o) => setVehicle({ id: o.id, vehicleNo: o.vehicleNo, ownerName: o.ownerName })}
              onClear={() => setVehicle(null)}
              addNew={{ label: "+ Add vehicle", onSelect: (q) => setVehicleDrawer({ open: true, no: q }) }}
              renderOption={(o) => (
                <div>
                  <b className="font-mono">{o.vehicleNo}</b>
                  <span className="text-muted">
                    {" · "}
                    {o.ownerName ?? "no owner"}
                    {o.vehicleTypeName ? ` · ${o.vehicleTypeName}` : ""}
                  </span>
                </div>
              )}
            />
            <Combobox<Awaited<ReturnType<typeof searchChallanDriversAction>>[number]>
              label="Driver"
              listLabel="Market drivers"
              placeholder="Name or mobile"
              selectedText={driver?.name ?? ""}
              error={err("driverId")}
              loadOptions={(q) => searchChallanDriversAction(q)}
              getKey={(o) => o.id}
              onPick={(o) => setDriver({ id: o.id, name: o.name })}
              onClear={() => setDriver(null)}
              addNew={{ label: "+ Add driver", onSelect: () => setDriverDrawer(true) }}
              renderOption={(o) => (
                <div>
                  <b>{o.name}</b>
                  <span className="text-muted">{o.mobile ? ` · ${o.mobile}` : ""}</span>
                </div>
              )}
            />
            <Combobox<{ id: string; name: string; mobile: string | null }>
              label={payeeKind === "broker" ? "Broker" : "Broker (optional)"}
              listLabel="Brokers"
              placeholder="Broker name or mobile"
              selectedText={broker?.name ?? ""}
              error={err("brokerId")}
              loadOptions={(q) => searchChallanBrokersAction(q)}
              getKey={(o) => o.id}
              onPick={(o) => setBroker({ id: o.id, name: o.name })}
              onClear={() => setBroker(null)}
              renderOption={(o) => (
                <div>
                  <b>{o.name}</b>
                  <span className="text-muted">{o.mobile ? ` · ${o.mobile}` : ""}</span>
                </div>
              )}
            />
            <Select
              label="Pay to"
              value={payeeKind}
              onChange={(e) => setPayeeKind(e.target.value as "owner" | "broker")}
              error={err("payeeKind")}
              hint={
                payeeName
                  ? `Lorry hire is paid to ${payeeName}.`
                  : payeeKind === "owner"
                    ? "The vehicle's owner is paid once a vehicle with an owner is picked."
                    : "Pick the broker to pay."
              }
            >
              <option value="owner">Owner</option>
              <option value="broker">Broker</option>
            </Select>
          </div>
        </Card>

        <Card title="Hire">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Rate basis"
              value={rateBasis}
              onChange={(e) => setRateBasis(e.target.value as "trip" | "per_tonne")}
            >
              <option value="trip">Per trip</option>
              <option value="per_tonne">Per tonne</option>
            </Select>
            <Field
              label={rateBasis === "trip" ? "Hire for the trip (₹)" : "Rate per tonne (₹)"}
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              error={err("rate")}
              hint={
                insights?.lane ? (
                  <span className={outlier?.outlier ? "font-semibold text-warning" : undefined}>
                    Lane median {money(insights.lane.medianRate)} · last{" "}
                    {insights.lane.rates
                      .slice(0, 3)
                      .map((r) => money(r))
                      .join(", ")}
                    {outlier?.outlier ? ` · ${outlier.abovePct.toFixed(0)}% above median` : ""}
                  </span>
                ) : undefined
              }
            />
            <Field
              label="Tonnes"
              inputMode="decimal"
              value={qty}
              onChange={(e) => {
                setQtyText(e.target.value);
                setQtyTouched(true);
              }}
              error={err("qtyTonnes")}
              hint={
                rateBasis === "per_tonne"
                  ? qtyTouched
                    ? "Typed by you."
                    : "From the loaded weights; you can change it."
                  : "Optional for a per-trip rate."
              }
            />
          </div>

          <h3 className="mt-6 mb-2 text-[15px] font-bold">Charges at hire</h3>
          {chargeTypes.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">
              No hire-stage charge types are switched on. Turn them on in Hire masters to add extra
              points, munshiana and similar here.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {charges.map((c, i) => (
                <div key={c.key} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1.2fr_1fr_1.5fr_auto]">
                  <Select
                    label={`Charge ${i + 1}`}
                    value={c.chargeTypeId}
                    onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, chargeTypeId: e.target.value } : x)))}
                    error={err(`charges.${i}.chargeTypeId`)}
                  >
                    {chargeTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} ({t.defaultDirection === "add" ? "+ adds to hire" : "− deducted"})
                      </option>
                    ))}
                  </Select>
                  <Field
                    label="Amount (₹)"
                    inputMode="decimal"
                    value={c.amount}
                    onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                    error={err(`charges.${i}.amount`)}
                  />
                  <Field
                    label="Note"
                    value={c.note}
                    onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
                    error={err(`charges.${i}.note`)}
                  />
                  <Button
                    variant="secondary"
                    className="sm:mt-[27px]"
                    aria-label={`Remove charge ${i + 1}`}
                    onClick={() => setCharges(charges.filter((_, j) => j !== i))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  variant="outline"
                  onClick={() =>
                    setCharges([...charges, { key: nextKey(), chargeTypeId: chargeTypes[0].id, amount: "", note: "" }])
                  }
                >
                  + Add charge
                </Button>
              </div>
            </div>
          )}

          <dl className="mt-6 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">Hire</dt>
            <dd className="m-0 text-right font-mono">{calc ? money(calc.hireAmount) : "—"}</dd>
            <dt className="text-muted">+ Additions</dt>
            <dd className="m-0 text-right font-mono">{calc ? money(calc.additions) : "—"}</dd>
            <dt className="text-muted">− Deductions</dt>
            <dd className="m-0 text-right font-mono">{calc ? money(calc.deductions) : "—"}</dd>
            <dt className="border-t border-border pt-1.5 font-bold">Payable to {payeeName ?? "payee"}</dt>
            <dd className="m-0 border-t border-border pt-1.5 text-right font-mono font-bold">
              {calc ? money(calc.netPayable) : "—"}
            </dd>
          </dl>
          <p className="mt-2 mb-0 text-[13px] text-muted">TDS is entered when the balance is paid.</p>
        </Card>

        <Card title="Remarks">
          <Textarea label="Remarks" hideLabel value={remarks} onChange={(e) => setRemarks(e.target.value)} error={err("remarks")} />
        </Card>
      </fieldset>

      {formError && <p className="m-0 text-[13px] text-danger">{formError}</p>}
      {savedNote && <p className="m-0 text-[13px] text-success">{savedNote}</p>}
      {!readOnly && (
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save as draft"}
          </Button>
          <Button disabled={pending} onClick={() => save("dispatch")}>
            Dispatch
          </Button>
        </div>
      )}
    </form>

    <aside className="flex flex-col gap-5 lg:sticky lg:top-4" aria-label="Trip summary">
      <Card title="Trip margin">
        {margin === null ? (
          <p className="m-0 text-[13px] text-muted">Add an LR and a hire rate to see the margin.</p>
        ) : (
          <>
            <div className={`font-mono text-2xl font-bold ${margin.low ? "text-danger" : "text-success"}`}>
              {formatRupees(margin.marginPaise)}
              <span className="ml-2 text-base">{margin.pct === null ? "" : `${margin.pct.toFixed(1)}%`}</span>
            </div>
            <dl className="mt-3 mb-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Party freight</dt>
              <dd className="m-0 text-right font-mono">{formatRupees(freightPaise)}</dd>
              <dt className="text-muted">Hire + additions</dt>
              <dd className="m-0 text-right font-mono">{formatRupees(grossPaise ?? 0)}</dd>
            </dl>
            {margin.low && (
              <p className="mt-2 mb-0 text-[13px] text-danger">
                {insights?.settings.minMarginPct != null
                  ? `Below the company minimum of ${insights.settings.minMarginPct}%.`
                  : "Below the company minimum margin."}
              </p>
            )}
          </>
        )}
      </Card>

      {warnings.length > 0 && (
        <Alert tone="warning" title={`${warnings.length} thing${warnings.length > 1 ? "s" : ""} to check`}>
          <ul className="m-0 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
    </aside>
    </div>

    {/* Outside the <form>: the drawers hold forms of their own. */}
      <QuickAddVehicleDrawer
        open={vehicleDrawer.open}
        initialVehicleNo={vehicleDrawer.no}
        onClose={() => setVehicleDrawer({ open: false, no: "" })}
        onCreated={(v) => {
          setVehicle({ id: v.id, vehicleNo: v.vehicleNo, ownerName: null });
          // The saved vehicle has only the owner's id; look the row up to show the owner's name.
          void searchChallanVehiclesAction(v.vehicleNo).then((rows) => {
            const row = rows.find((r) => r.id === v.id);
            if (row) setVehicle({ id: row.id, vehicleNo: row.vehicleNo, ownerName: row.ownerName });
          });
        }}
      />
      <QuickAddDriverDrawer
        open={driverDrawer}
        onClose={() => setDriverDrawer(false)}
        onCreated={(d) => setDriver({ id: d.id, name: d.name })}
      />
    </>
  );
}
