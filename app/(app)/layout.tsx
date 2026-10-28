import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PermissionsProvider } from "@/components/ui/Permissions";
import { Sidebar } from "@/components/ui/Sidebar";
import { getActiveCompanyId, getRole } from "@/lib/data/session";

// App shell from design/screens/Main.dc.html. The flex-wrap layout stacks the
// sidebar above the content once the screen is narrower than 268px + 624px.
// (The design's 560px basis excludes its 32px padding; ours includes it.)
const shell = "@container flex min-h-screen flex-wrap bg-page font-sans text-text";

/** Reads the signed-in user's role once, for every screen's buttons (IfCan / useCan). */
async function SignedInShell({ children }: { children: React.ReactNode }) {
  // Sends logged-out visitors to /login (a stale or forged cookie gets past proxy.ts).
  const role = await getRole(await getActiveCompanyId());
  // Drivers only use the phone app.
  if (role === "driver") redirect("/driver");
  return (
    <PermissionsProvider role={role}>
      {/* @container: the sidebar uses the shell's own width (not the viewport, which
          includes the scrollbar) to know whether it is side by side or stacked. */}
      <div className={shell}>
        <Sidebar />
        <main className="flex min-w-0 flex-[999_1_624px] flex-col gap-6 p-page">{children}</main>
      </div>
    </PermissionsProvider>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense
      fallback={
        <div className={shell}>
          <div className="flex-[1_1_268px] bg-navy" />
          <div className="flex-[999_1_624px]" />
        </div>
      }
    >
      <SignedInShell>{children}</SignedInShell>
    </Suspense>
  );
}
