import { PageHeader } from "@/components/ui/PageHeader";

// Temporary stand-in so sidebar links resolve. Replace with the real screen.
export function PlaceholderPage({ title }: { title: string }) {
  return <PageHeader title={title} subtitle="This screen is not built yet." />;
}
