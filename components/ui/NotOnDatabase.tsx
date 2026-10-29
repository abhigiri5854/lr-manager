import { Card } from "@/components/ui/Card";
import { NOT_ON_DATABASE_AREAS } from "@/lib/data/source";

/**
 * Shown instead of a screen whose data hasn't moved to the database yet (DATA_SOURCE=db).
 * Temporary: goes away when the area is switched over.
 */
export function NotOnDatabase({ what }: { what: string }) {
  return (
    <Card title={`${what} — not yet on the database`}>
      <p className="m-0 text-sm text-muted">
        Company profile, Users &amp; roles, Parties, Trucks &amp; drivers, Items, LRs, POD and the
        dashboard now save to the database. {NOT_ON_DATABASE_AREAS} move over in the next step; until then this screen is off
        so sample data and real data are never mixed.
      </p>
      <p className="mt-3 mb-0 text-sm text-muted">
        To try it on sample data, set <code className="font-mono">DATA_SOURCE=mock</code> in{" "}
        <code className="font-mono">.env.local</code> and restart the dev server.
      </p>
    </Card>
  );
}
