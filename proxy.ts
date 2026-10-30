import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: no session cookie → /login. The cookie's signature, the user and
// their company are checked properly in lib/data/session.ts on every request.
const SESSION_COOKIE = "lrm_session"; // lib/data/session.ts SESSION_COOKIE

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = new URL("/login", request.url);
  const back = request.nextUrl.pathname + request.nextUrl.search;
  if (back !== "/") url.searchParams.set("next", back);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login and register pages and Next's own files.
  matcher: ["/((?!login|register|_next/static|_next/image|favicon.ico).*)"],
};
