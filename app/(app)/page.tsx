import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <PlaceholderPage title="Dashboard" />;
}
