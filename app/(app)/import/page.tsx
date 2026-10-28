import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CommitButton } from "@/components/import/CommitButton";
import { DocumentReview } from "@/components/import/DocumentReview";
import { ExcelReview } from "@/components/import/ExcelReview";
import { FilesTable } from "@/components/import/FilesTable";
import { ImportHistory } from "@/components/import/ImportHistory";
import { ImportSteps } from "@/components/import/ImportSteps";
import { ImportUploader } from "@/components/import/ImportUploader";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  getDocumentReview,
  getExcelReview,
  getImportResult,
  listImportFiles,
  listImportHistory,
  listImportMappings,
} from "@/lib/data/import";
import { getActiveCompanyId, getRole } from "@/lib/data/session";
import { stepsDone } from "@/lib/import/labels";
import { can, deniedMessage } from "@/lib/permissions";

export const metadata: Metadata = { title: "Smart import" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const SUBTITLE =
  "Drop Excel booking reports, invoices or LRs — as .xlsx, .csv, PDF or photo. AI reads each file, maps every field and shows where it will be saved. Nothing enters the system until you click Import.";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Per request: the active company, the URL (?batch=<file> to review, ?imported=<file> after) and the role. */
async function ImportScreen({
  searchParams,
}: {
  searchParams: PageProps<"/import">["searchParams"];
}) {
  const params = await searchParams;
  const companyId = await getActiveCompanyId();
  const role = await getRole(companyId);
  if (!can(role, "import.run")) {
    return (
      <NoAccess
        title="Smart import"
        role={role}
        action="import.run"
        back={{ href: "/", label: "Back to the Dashboard" }}
      />
    );
  }
  const batchId = one(params.batch) ?? null;
  const importedId = one(params.imported) ?? null;
  const hpage = Number(one(params.hpage)) || 1;
  const [files, history, mappings, excel, document, result] = await Promise.all([
    listImportFiles(companyId, batchId),
    listImportHistory(companyId, { page: hpage }),
    listImportMappings(companyId),
    batchId ? getExcelReview(companyId, batchId) : null,
    batchId ? getDocumentReview(companyId, batchId) : null,
    importedId ? getImportResult(companyId, importedId) : null,
  ]);

  const canLr = can(role, "lr.edit");
  // Just imported → all four steps done; otherwise the file being reviewed (or the newest one).
  const status = result
    ? ("imported" as const)
    : (excel?.status ?? files.find((f) => f.id === batchId)?.status ?? files[0]?.status ?? null);
  const commitReason = !excel
    ? "Choose an Excel file below and click Review first."
    : !canLr
      ? deniedMessage(role, "lr.edit")
      : !excel.canImport
        ? excel.status === "imported"
          ? "This file has already been imported."
          : "Nothing to import — every row is skipped or has an error."
        : null;

  return (
    <>
      <PageHeader
        eyebrow="DATA TOOLS"
        title="Smart import"
        subtitle={SUBTITLE}
        actions={
          <CommitButton
            batchId={excel?.batchId ?? null}
            importable={excel?.importable ?? 0}
            reason={commitReason}
          />
        }
      />

      <Alert tone="info" title="Demo reader.">
        Files are read by a stand-in for now, so you get sample results (a booking sheet, invoice
        SQ2604002116) whatever you upload. The real Excel and AI readers plug in here later.
      </Alert>

      {result && (
        <Alert
          tone="info"
          title={`Imported ${result.fileName}.`}
          action={
            <span className="flex flex-wrap gap-3">
              {result.lrs > 0 && <Link href="/lr">Open LR register</Link>}
              {result.errorRows > 0 && (
                <Link href={`/import/${result.batchId}/errors`} prefetch={false}>
                  Download error report (.xlsx)
                </Link>
              )}
            </span>
          }
        >
          {plural(result.lrs, "draft LR")} created
          {result.parties > 0 && `, ${plural(result.parties, "new party", "new parties")}`}
          {result.trucks > 0 && `, ${plural(result.trucks, "new truck")}`}
          {result.errorRows > 0 && ` · ${plural(result.errorRows, "row")} with errors left out`}.
        </Alert>
      )}

      <ImportSteps done={stepsDone(status)} />

      <ImportUploader
        excelBlocked={canLr ? null : deniedMessage(role, "lr.edit")}
        documentsBlocked={can(role, "invoice.edit") ? null : deniedMessage(role, "invoice.edit")}
        mappingNames={mappings.map((m) => m.name)}
      />

      <FilesTable files={files} canRemove />

      {excel ? (
        <ExcelReview view={excel} canEdit={canLr} />
      ) : document ? (
        <DocumentReview view={document} />
      ) : (
        <Card title="Review">
          <p className="m-0 text-sm text-muted">
            {files.length
              ? "Click Review (or Open in Tax invoice) on a file above to check its columns and rows before anything is saved."
              : "After you upload a file, its column mapping and row review appear here."}
          </p>
        </Card>
      )}

      <ImportHistory
        history={history}
        hrefFor={(p) => `/import?${batchId ? `batch=${batchId}&` : ""}hpage=${p}`}
      />
    </>
  );
}

function ImportSkeleton() {
  return (
    <>
      <PageHeader eyebrow="DATA TOOLS" title="Smart import" subtitle={SUBTITLE} />
      <Skeleton className="h-12 rounded-tile" />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
      <Skeleton className="h-48 rounded-card" />
    </>
  );
}

export default function ImportPage({ searchParams }: PageProps<"/import">) {
  return (
    <Suspense fallback={<ImportSkeleton />}>
      <ImportScreen searchParams={searchParams} />
    </Suspense>
  );
}
