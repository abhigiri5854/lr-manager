import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Driver app" };

export default function DriverPage() {
  return (
    <main className="p-page">
      <PlaceholderPage title="Driver app" />
    </main>
  );
}
