import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  rewrites: async () => [
    {
      // Proxy browser Supabase requests through Next.js server
      // Browser hits /supabase-proxy/* → server forwards to internal Supabase
      // This allows mobile/external clients to access Supabase through
      // the single app endpoint without exposing Supabase directly
      source: "/supabase-proxy/:path*",
      destination: `${process.env.SUPABASE_URL || "http://supabase-kong:8000"}/:path*`,
    },
  ],
};

export default nextConfig;
