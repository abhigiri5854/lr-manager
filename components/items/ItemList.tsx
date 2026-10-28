"use client";

import Link from "next/link";
import { useState } from "react";
import { LinkButton } from "@/components/trucks/LinkButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Pagination } from "@/components/ui/Pagination";
import { formatPaise } from "@/lib/format";
import { formatGstRate } from "@/lib/gst";
import type { Item, Page } from "@/lib/types";
import { itemListSearch, type ItemListQuery } from "@/lib/validators/item-list";
import { ItemFilters } from "./ItemFilters";
import { ItemForm } from "./ItemForm";

/** "+ Add item" button with its dialog (page header). */
export function AddItemButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add item</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add item"
        description="Typing its code or name on an invoice line fills HSN, UOM, GST % and rate."
      >
        <ItemForm onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function emptyText(query: ItemListQuery, page: Page<unknown>) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`/items${itemListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (query.q) {
    return (
      <>
        No item matches &ldquo;{query.q}&rdquo;. <Link href="/items">Clear search</Link>
      </>
    );
  }
  return "No items yet. Use + Add item, or add them from an invoice line.";
}

/** Search + table for /items, with the Edit dialog. */
export function ItemList({
  query,
  page,
  loading,
}: {
  query: ItemListQuery;
  page?: Page<Item>;
  loading?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  const [editId, setEditId] = useState<string | null>(null);
  const editing = data.rows.find((r) => r.id === editId);

  const columns: Column<Item>[] = [
    { key: "code", header: "Item code", cell: (r) => r.code ?? "—", mono: true },
    { key: "name", header: "Name", cell: (r) => r.name, wrap: true },
    { key: "hsn", header: "HSN", cell: (r) => r.hsn ?? "—", mono: true },
    { key: "uom", header: "UOM", cell: (r) => r.uom ?? "—" },
    {
      key: "gst",
      header: "GST",
      cell: (r) => (r.gstRateBp == null ? "—" : formatGstRate(r.gstRateBp)),
      align: "right",
    },
    {
      key: "rate",
      header: "Last rate ₹",
      cell: (r) => (r.lastRatePaise == null ? "—" : formatPaise(r.lastRatePaise)),
      align: "right",
    },
    {
      key: "edit",
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <LinkButton onClick={() => setEditId(r.id)} aria-label={`Edit ${r.name}`}>
          Edit
        </LinkButton>
      ),
    },
  ];

  return (
    <>
      <ItemFilters query={query} disabled={loading} />
      <Card padding="table">
        <DataTable
          label="Items"
          columns={columns}
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={loading ? "Loading…" : emptyText(query, data)}
        />
        {!loading && (
          <div className="mx-3 mt-4">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              noun={data.total === 1 ? "item" : "items"}
              hrefFor={(p) => `/items${itemListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
      <Dialog open={!!editing} onClose={() => setEditId(null)} title="Edit item">
        {editing && <ItemForm item={editing} onDone={() => setEditId(null)} />}
      </Dialog>
    </>
  );
}

export function ItemListSkeleton() {
  return <ItemList query={{ page: 1 }} loading />;
}
