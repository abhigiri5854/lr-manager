import type { Metadata } from "next";
import { DriverProvider } from "@/components/driver/DriverProvider";

export const metadata: Metadata = {
  title: "Driver",
  manifest: "/d/manifest.webmanifest",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  appleWebApp: { capable: true, title: "Driver", statusBarStyle: "default" },
  icons: { icon: "/icons/driver-192.png", apple: "/icons/driver-192.png" },
};

// No login here: the token in the URL is the credential (see lib/data/driver-links.ts).
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <DriverProvider>{children}</DriverProvider>;
}
