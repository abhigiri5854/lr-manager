import type { Metadata } from "next";
import { Suspense } from "react";
import { AddItemButton, ItemList, ItemListSkeleton } from "@/components/items/ItemList";
import { PageHeader } from "@/components/ui/PageHeader";
import { listItems } from "@/lib/data/items";
import { getActiveCompanyId } from "@/lib/data/session";
import { parseItemListQuery } from "@/lib/validators/item-list";

export const metadata: Metadata = { title: "Items" };

const SUBTITLE =
  "Goods you invoice. Typing a code or name on an invoice line fills description, HSN, UOM, GST % and last rate.";

/** Per request: reads the URL and the active company. */
async function ItemListLoader({ searchParams }: Pick<PageProps<"/items">, "searchParams">) {
  const query = parseItemListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const page = await listItems(companyId, { search: query.q, page: query.page });
  return <ItemList query={query} page={page} />;
}

export default function ItemsPage({ searchParams }: PageProps<"/items">) {
  return (
    <>
      <PageHeader title="Items" subtitle={SUBTITLE} actions={<AddItemButton />} />
      <Suspense fallback={<ItemListSkeleton />}>
        <ItemListLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}
