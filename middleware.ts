import { NextRequest, NextResponse } from "next/server";

const protectedPaths = ["/workspace", "/settings", "/history", "/admin"];

function isProtectedPath(pathname: string) {
  return (
    protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    pathname.startsWith("/api/process") ||
    pathname.startsWith("/api/workflow") ||
    pathname.startsWith("/api/jobs") ||
    pathname.startsWith("/api/account") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/errors")
  );
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get("transcripter_session")?.value);

  if (isProtectedPath(pathname) && !hasSessionCookie) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if ((pathname === "/login" || pathname === "/register") && hasSessionCookie) {
    return NextResponse.redirect(new URL("/workspace", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
