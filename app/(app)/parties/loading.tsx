import { AddPartyButton } from "@/components/parties/AddPartyButton";
import { PartyListSkeleton } from "@/components/parties/PartyList";
import { PageHeader } from "@/components/ui/PageHeader";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Parties"
        subtitle="Consignors, consignees and billing parties. Saved details fill every new LR and invoice."
        actions={<AddPartyButton />}
      />
      <PartyListSkeleton />
    </>
  );
}
