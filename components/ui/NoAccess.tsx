import Link from "next/link";
import { deniedMessage, type Action } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { Alert } from "./Alert";
import { PageHeader } from "./PageHeader";

/** Shown instead of a screen the role can't use (e.g. New LR for an Accountant). */
export function NoAccess({
  title,
  role,
  action,
  back,
}: {
  title: string;
  role: Role | null;
  action: Action;
  back: { href: string; label: string };
}) {
  return (
    <>
      <PageHeader title={title} />
      <Alert tone="info" title={deniedMessage(role, action)}>
        Ask your company Owner if you need this. <Link href={back.href}>{back.label}</Link>
      </Alert>
    </>
  );
}
