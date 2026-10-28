import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Party" };

export default function PartyPage() {
  return <PlaceholderPage title="Party" />;
}
