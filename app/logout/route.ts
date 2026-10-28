import { NextResponse } from "next/server";
import { logOut } from "@/lib/data/session";

/**
 * Log out (sidebar form POST). A full-page redirect, not a client navigation, so the browser
 * drops every page it kept in memory — Back can't show the last user's screens.
 * NextResponse (not Response.redirect, whose headers are read-only) so the cookie
 * deletions from logOut() can be added to it.
 */
export async function POST(request: Request) {
  await logOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
