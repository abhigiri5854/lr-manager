import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "UI components" };

// Component gallery for checking against design/screens. Dev only.
// Values below are placeholders for the gallery, not app data.

type DemoRow = { id: string; no: string; party: string; truck: string; amount: string };

const demoRows: DemoRow[] = [
  {
    id: "demo-1",
    no: "00001",
    party: "Sample consignee A",
    truck: "XX00AA0000",
    amount: "1,000.00",
  },
  {
    id: "demo-2",
    no: "00002",
    party: "Sample consignee B",
    truck: "XX00BB0000",
    amount: "25,500.00",
  },
];

const demoColumns: Column<DemoRow>[] = [
  { key: "no", header: "LR No", cell: (r) => r.no, mono: true },
  { key: "party", header: "Consignee", cell: (r) => r.party },
  { key: "truck", header: "Truck", cell: (r) => r.truck, mono: true },
  { key: "amount", header: "Value ₹", cell: (r) => r.amount, align: "right" },
  { key: "status", header: "Status", cell: () => <Chip tone="blue">In transit</Chip> },
];

function Demo({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold tracking-[0.08em] text-muted">{name}</div>
      {children}
    </div>
  );
}

const grid = "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4";

export default function UiGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <>
      <PageHeader
        eyebrow="DEV"
        title="UI components"
        subtitle="Every shared component in every state. Compare against design/screens."
      />

      <Card title="PageHeader">
        <div className="flex flex-col gap-8">
          <Demo name="BREADCRUMB ABOVE + SUBTITLE + ACTIONS (LRView)">
            <div className="flex flex-col gap-5 rounded-control bg-page p-4">
              <PageHeader
                breadcrumb={[{ label: "LR register", href: "#" }, { label: "LR 00001" }]}
                title={
                  <>
                    LR <span className="font-mono text-primary">00001</span>{" "}
                    <Chip tone="blue" className="align-middle">
                      In transit
                    </Chip>
                  </>
                }
                subtitle="dd-mm-yyyy · Consignor → Consignee · From → To"
                actions={
                  <>
                    <Button variant="secondary">Edit</Button>
                    <Button>Print LR</Button>
                  </>
                }
              />
            </div>
          </Demo>
          <Demo name="BREADCRUMB INLINE (NewLR)">
            <div className="flex flex-col gap-5 rounded-control bg-page p-4">
              <PageHeader
                breadcrumbPlacement="inline"
                breadcrumb={[{ label: "Dashboard", href: "#" }, { label: "New consignment note" }]}
                title={
                  <>
                    New LR <span className="font-mono text-primary">00003</span>{" "}
                    <span className="text-[13px] font-medium text-muted">auto-numbered</span>
                  </>
                }
                actions={
                  <>
                    <Button variant="secondary">Save draft</Button>
                    <Button>Save &amp; print</Button>
                  </>
                }
              />
            </div>
          </Demo>
          <Demo name="BACK LINK (POD)">
            <div className="flex flex-col gap-5 rounded-control bg-page p-4">
              <PageHeader
                breadcrumb={[{ label: "← LR 00001", href: "#" }]}
                title="POD · LR 00001"
              />
            </div>
          </Demo>
          <Demo name="EYEBROW (Settings / Import)">
            <div className="flex flex-col gap-5 rounded-control bg-page p-4">
              <PageHeader
                eyebrow="SETTINGS"
                title="Company profile"
                subtitle="Subtitle text in 14px muted, up to 720px wide."
                actions={<Button variant="dark">Save</Button>}
              />
            </div>
          </Demo>
        </div>
      </Card>

      <Card title="Button">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="dark">Dark</Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button disabled>Primary disabled</Button>
            <Button variant="secondary" disabled>
              Secondary disabled
            </Button>
            <Button variant="outline" disabled>
              Outline disabled
            </Button>
            <Button variant="dark" disabled>
              Dark disabled
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href="#">+ New LR (link)</Button>
            <Button href="#" variant="secondary">
              Preview PDF (link)
            </Button>
            <Button href="#" disabled>
              Disabled link
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Chip">
        <div className="flex flex-wrap gap-2">
          <Chip tone="blue">In transit</Chip>
          <Chip tone="amber">POD pending</Chip>
          <Chip tone="green">Delivered</Chip>
          <Chip tone="grey">Draft</Chip>
          <Chip tone="red">Error</Chip>
        </div>
      </Card>

      <Card title="Field, Select, Textarea">
        <div className="flex flex-col gap-6">
          <Demo name="DEFAULT">
            <div className={grid}>
              <Field label="LR date" placeholder="dd-mm-yyyy" />
              <Field label="With value" defaultValue="Some text" />
              <Field label="With hint" hint="Helper text under the input." />
              <Field label="Mono value" defaultValue="XX00AA0000" className="[&_input]:font-mono" />
            </div>
          </Demo>
          <Demo name="ERROR / DISABLED">
            <div className={grid}>
              <Field
                label="GSTIN"
                defaultValue="10AABCA7061K2Z"
                error="GSTIN has 14 characters (needs 15)"
              />
              <Field label="Disabled" defaultValue="Locked value" disabled />
              <Select label="Select error" error="Pick a party">
                <option>Choose…</option>
              </Select>
              <Textarea label="Textarea error" error="Required" />
            </div>
          </Demo>
          <Demo name="AI-FLAGGED (Import / Invoice)">
            <div className={grid}>
              <Field
                label="Goods value (₹)"
                defaultValue="1,000.00"
                aiFlag="low-confidence"
                aiNote="Low confidence — check against the invoice"
              />
              <Field
                label="E-way bill no."
                placeholder="Not on invoice – enter"
                aiFlag="low-confidence"
              />
              <Field
                label="Bill to"
                defaultValue="Sample party"
                aiFlag="new-record"
                aiNote="New party — saved on Save"
              />
              <Select label="Select flagged" aiFlag="low-confidence">
                <option>Guessed option</option>
              </Select>
            </div>
          </Demo>
          <Demo name="SELECT / TEXTAREA">
            <div className={grid}>
              <Select label="Status" defaultValue="all">
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="transit">In transit</option>
              </Select>
              <Select label="Disabled select" disabled>
                <option>Fixed</option>
              </Select>
              <Textarea label="Remarks" placeholder="Shortage, damage or note from consignee" />
              <Textarea label="Disabled textarea" defaultValue="Read only" disabled />
            </div>
          </Demo>
          <Demo name="HIDDEN LABEL (table cell; label still read by screen readers)">
            <div className="max-w-[240px]">
              <Select label="Action for row" hideLabel>
                <option>Fix &amp; import</option>
                <option>Skip</option>
              </Select>
            </div>
          </Demo>
        </div>
      </Card>

      <Demo name="DATATABLE — CARD PADDING 'TABLE', ROW LINKS">
        <Card padding="table">
          <DataTable
            label="Demo rows"
            columns={demoColumns}
            rows={demoRows}
            rowKey={(r) => r.id}
            rowHref={() => "#"}
          />
        </Card>
      </Demo>

      <Demo name="DATATABLE — EMPTY">
        <Card padding="table">
          <DataTable
            label="Empty demo"
            columns={demoColumns}
            rows={[]}
            rowKey={(r) => r.id}
            empty="No LRs match these filters."
          />
        </Card>
      </Demo>

      <Card title="DataTable in a titled card" action={<a href="#">Open register</a>}>
        <DataTable
          label="Demo rows, no links"
          columns={demoColumns}
          rows={demoRows}
          rowKey={(r) => r.id}
        />
      </Card>

      <Card title="Alert">
        <div className="flex flex-col gap-4">
          <Alert tone="info" title="Read by AI from sample.png">
            · orange fields are new records or low-confidence — check them
          </Alert>
          <Alert
            tone="info"
            title="Info with action"
            action={<Button variant="secondary">Undo</Button>}
          >
            Filled from the last LR for this party.
          </Alert>
          <Alert tone="warning" title="E-way bill">
            · not generated — value is above the limit, so it is required
          </Alert>
          <Alert tone="warning">Warning without a title.</Alert>
        </div>
      </Card>

      <div className={grid}>
        <Card title="Card with title">Body text inside a 20px padded card.</Card>
        <Card title="Card with action" action={<a href="#">Open</a>}>
          Title row uses a 12px gap below when there is an action.
        </Card>
        <Card>Card without title.</Card>
      </div>
    </>
  );
}
