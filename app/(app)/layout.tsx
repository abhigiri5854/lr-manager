import { Sidebar } from "@/components/ui/Sidebar";

// App shell from design/screens/Main.dc.html. The flex-wrap layout stacks the
// sidebar above the content once the screen is narrower than 268px + 624px.
// (The design's 560px basis excludes its 32px padding; ours includes it.)
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    // @container: the sidebar uses the shell's own width (not the viewport, which
    // includes the scrollbar) to know whether it is side by side or stacked.
    <div className="@container flex min-h-screen flex-wrap bg-page font-sans text-text">
      <Sidebar />
      <main className="flex min-w-0 flex-[999_1_624px] flex-col gap-6 p-page">{children}</main>
    </div>
  );
}
