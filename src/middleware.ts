import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_COOKIE_NAME } from "@/lib/supabase/constants";

const publicPaths = ["/login", "/register", "/callback", "/api/webhooks"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));

  // Fast-path: no auth cookie → redirect immediately without Supabase round-trip
  const hasAuthCookie = request.cookies
    .getAll()
    .some(
      (c) =>
        c.name === SUPABASE_COOKIE_NAME ||
        c.name.startsWith(`${SUPABASE_COOKIE_NAME}.`)
    );
  if (!hasAuthCookie && !isPublicPath && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        name: SUPABASE_COOKIE_NAME,
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|supabase-proxy|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
