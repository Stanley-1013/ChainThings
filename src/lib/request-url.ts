import { NextRequest } from "next/server";

// Resolve the public-facing URL of an incoming request, respecting
// X-Forwarded-* headers set by reverse proxies (ngrok, kong, fly, etc).
//
// Why: Next.js' standalone server binds to a private hostname like
// `0.0.0.0:3000` inside Docker. Using plain `request.url` for redirects
// echoes that internal hostname back to the browser, which the user can't
// reach. NextRequest.nextUrl handles forwarded headers automatically;
// route handlers that take a plain Request (or want a string base) need
// this helper.
export function publicOrigin(request: Request | NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}`;
  }
  // No forwarded headers — use whatever URL Next.js parsed
  return new URL(request.url).origin;
}

export function publicUrl(
  request: Request | NextRequest,
  pathAndQuery: string,
): URL {
  return new URL(pathAndQuery, publicOrigin(request));
}
