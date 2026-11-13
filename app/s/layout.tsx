import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Statement",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// No login here: the token in the URL is the credential (see lib/data/party-statements.ts).
export default function StatementLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
