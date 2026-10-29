import { NotOnDatabase } from "@/components/ui/NotOnDatabase";
import { onDatabase } from "@/lib/data/source";

// Temporary (prompt 19a): this area still runs on the mock store.
export default function Layout({ children }: { children: React.ReactNode }) {
  if (onDatabase()) return <NotOnDatabase what="LRs" />;
  return children;
}
