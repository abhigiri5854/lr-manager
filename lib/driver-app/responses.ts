// Shared JSON responses for the /d/[token]/* route handlers. Server only. Never cached.
import { NextResponse } from "next/server";
import { DriverLinkError, TooManyRequestsError } from "@/lib/driver-link";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** 404 = the link itself is gone (trips / history). */
export const linkGone = () => json({ error: "invalid", message: "Link is not active" }, 404);

export function errorResponse(e: unknown) {
  if (e instanceof DriverLinkError) return json({ error: "link", message: e.message }, 403);
  if (e instanceof TooManyRequestsError) return json({ error: "rate", message: e.message }, 429);
  console.error("driver route", e);
  return json({ error: "failed", message: e instanceof Error ? e.message : "Something went wrong" }, 400);
}

export type TokenContext = { params: Promise<{ token: string }> };

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
