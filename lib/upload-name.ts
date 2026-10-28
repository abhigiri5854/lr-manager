/** File name kept in a stored upload URL (`/uploads/<id>?n=<name>`). */
export function uploadName(url: string): string {
  const n = new URL(url, "http://x").searchParams.get("n");
  return n || "Signed copy";
}
