import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "session";

const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/jobs/")
  ) {
    return NextResponse.next();
  }

  const appSecret = process.env.APP_SECRET;
  const session = request.cookies.get(SESSION_COOKIE)?.value;

  if (!appSecret || session !== appSecret) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and Next internals; everything else goes through the
  // shared-secret check above. /api/jobs/* is excluded above (cron-secret auth
  // instead) rather than here, since it still needs to match this matcher to
  // reach the function that lets it through.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
