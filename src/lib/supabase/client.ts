import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          // Skip ngrok's browser interstitial warning page on free plan
          // Without this, fetch requests through ngrok get HTML instead of JSON
          "ngrok-skip-browser-warning": "1",
        },
      },
    }
  );
}
