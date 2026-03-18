import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_COOKIE_NAME } from "./constants";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        name: SUPABASE_COOKIE_NAME,
      },
      global: {
        fetch: (url, options = {}) => {
          const headers = new Headers(options.headers);
          headers.set("ngrok-skip-browser-warning", "1");
          return fetch(url, { ...options, headers });
        },
      },
    }
  );
}
