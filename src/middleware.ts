import { NextResponse, type NextRequest } from "next/server";

// A quick first check: no session cookie → the sign-in page. The session itself is verified on the server by the
// CRM layout, API routes and server actions (auth() / requireUser()), so this needs no secret on the edge.
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

export default function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/login")) return NextResponse.next();
  if (req.cookies.getAll().some((c) => SESSION_COOKIE.test(c.name))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?callbackUrl=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/auth|api/intake|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
