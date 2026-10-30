"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resetPasswordAction,
} from "@/app/(app)/settings/users/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCan } from "@/components/ui/Permissions";
import type { MemberRow } from "@/lib/data/members";
import { formatDate } from "@/lib/format";
import { todayInIndia } from "@/lib/fy";
import { ROLE_LABEL, ROLES } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { OFFICE_ROLES } from "@/lib/validators/member";

// Chip colours from Users.dc.html (Accountant isn't in the design; grey like Booking staff).
const ROLE_TONE: Record<Role, ChipTone> = {
  owner: "blue",
  accountant: "grey",
  booking_staff: "grey",
  driver: "amber",
};

/** "28-10-2026, 18:05" in India time. */
function lastLogin(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return `${formatDate(todayInIndia(at))}, ${time}`;
}

/** Users & roles (Users.dc.html): header, members table, invite and edit dialogs. */
export function UsersScreen({
  rows,
  companyLabel,
  permissionTable,
}: {
  rows: MemberRow[];
  companyLabel: string;
  /** Server-rendered "What each role can do" card. */
  permissionTable: ReactNode;
}) {
  const canManage = useCan("company.manage");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  /** One-time password to pass on after an invite / reset. */
  const [handover, setHandover] = useState<{
    who: string;
    mobile: string;
    password: string;
  } | null>(null);

  const columns: Column<MemberRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <>
          {r.name}
          {r.isMe && <span className="text-muted"> (you)</span>}
        </>
      ),
    },
    { key: "contact", header: "Mobile / email", cell: (r) => r.mobile ?? r.email ?? "—" },
    {
      key: "role",
      header: "Role",
      cell: (r) => <Chip tone={ROLE_TONE[r.role]}>{ROLE_LABEL[r.role]}</Chip>,
    },
    { key: "login", header: "Last login", cell: (r) => lastLogin(r.lastLoginAt) },
    {
      key: "edit",
      header: <span className="sr-only">Actions</span>,
      cell: (r) =>
        canManage ? (
          <button
            type="button"
            onClick={() => setEditing(r)}
            aria-label={`Edit ${r.name}`}
            className="cursor-pointer border-0 bg-transparent p-0 text-sm text-primary underline hover:text-primary-hover"
          >
            Edit
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="SETTINGS"
        title="Users & roles"
        subtitle="Who can log in, for which company, and what they can do."
        actions={canManage && <Button onClick={() => setInviting(true)}>+ Invite user</Button>}
      />
      {!canManage && (
        <Alert tone="info">Only the company Owner can invite people or change roles.</Alert>
      )}
      {handover && (
        <Alert tone="warning" title={`One-time password for ${handover.who}:`}>
          <b className="font-mono">{handover.password}</b> — share it with them privately. They log
          in with mobile {handover.mobile}. It isn&apos;t shown again.{" "}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-semibold underline"
            onClick={() => setHandover(null)}
          >
            Done
          </button>
        </Alert>
      )}
      <Card>
        <DataTable
          label={`People in ${companyLabel}`}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.membershipId}
          empty="No one yet."
        />
      </Card>
      {permissionTable}

      <Dialog
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite user"
        description={`Adds them to ${companyLabel}. Someone new gets a login with a one-time password. Drivers are added from Trucks & drivers.`}
      >
        <InviteForm
          onDone={(r) => {
            setInviting(false);
            if (r) setHandover(r);
          }}
        />
      </Dialog>
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : "Edit"}
        description={`Role in ${companyLabel}.`}
      >
        {editing && (
          <EditForm
            row={editing}
            companyLabel={companyLabel}
            onDone={(r) => {
              setEditing(null);
              if (r) setHandover(r);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

type Handover = { who: string; mobile: string; password: string } | null;

function InviteForm({ onDone }: { onDone: (handover: Handover) => void }) {
  const [v, setV] = useState({ name: "", mobile: "", email: "", role: "booking_staff" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bind = (key: keyof typeof v) => ({
    name: key,
    value: v[key],
    onChange: (e: { target: { value: string } }) => setV((s) => ({ ...s, [key]: e.target.value })),
    error: errors[key],
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const r = await inviteMemberAction({
            ...v,
            role: v.role as (typeof OFFICE_ROLES)[number],
          });
          if (r.ok) {
            onDone(
              r.tempPassword ? { who: v.name, mobile: v.mobile, password: r.tempPassword } : null,
            );
          } else if (r.kind === "validation") {
            setErrors(Object.fromEntries(r.issues.map((i) => [i.path || "form", i.message])));
          } else setFormError(r.message);
        });
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <Field label="Name" className="sm:col-span-2" autoFocus {...bind("name")} />
      <Field label="Mobile no." type="tel" inputMode="tel" {...bind("mobile")} />
      <Field label="Email (optional)" type="email" inputMode="email" {...bind("email")} />
      <Select label="Role" className="sm:col-span-2" {...bind("role")}>
        {OFFICE_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
      {(formError || errors.form) && (
        <p role="alert" className="m-0 text-sm text-danger sm:col-span-2">
          {formError ?? errors.form}
        </p>
      )}
      <div className="mt-2 flex flex-wrap justify-end gap-3 sm:col-span-2">
        <Button variant="secondary" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Inviting…" : "Invite"}
        </Button>
      </div>
    </form>
  );
}

function EditForm({
  row,
  companyLabel,
  onDone,
}: {
  row: MemberRow;
  companyLabel: string;
  onDone: (handover: Handover) => void;
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(row.role);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(
    call: () => Promise<{ ok: true; tempPassword?: string } | { ok: false; message: string }>,
  ) {
    setError(null);
    startTransition(async () => {
      const r = await call();
      if (!r.ok) {
        setError(r.message);
        return;
      }
      onDone(
        r.tempPassword
          ? { who: row.name, mobile: row.mobile ?? "", password: r.tempPassword }
          : null,
      );
      router.refresh();
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (role === row.role) onDone(null);
        else run(() => changeRoleAction(row.membershipId, row.version, role));
      }}
      className="flex flex-col gap-4"
    >
      <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {ROLES.filter((r) => r !== "driver" || row.role === "driver").map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
      {row.isMe && role !== "owner" && row.role === "owner" && (
        <Alert tone="warning">
          You won&apos;t be able to manage users of {companyLabel} after this.
        </Alert>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={() => onDone(null)}>
          Close
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save role"}
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-border-row pt-4">
        {row.mobile && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted">Forgot their password?</span>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => resetPasswordAction(row.membershipId))}
            >
              Set new password
            </Button>
          </div>
        )}
        {confirmRemove ? (
          <Alert tone="warning" title={`Remove ${row.name} from ${companyLabel}?`}>
            They can no longer log in to this company. Their past work stays in the activity log.
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => run(() => removeMemberAction(row.membershipId))}
              >
                {pending ? "Removing…" : "Remove"}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                Keep
              </Button>
            </div>
          </Alert>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted">No longer works here?</span>
            <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
              Remove from company…
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
