import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const metadata: Metadata = { title: "Login" };

export default function LoginPage() {
  return (
    <main className="p-page">
      <PlaceholderPage title="Login" />
    </main>
  );
}
