import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  rewrites: async () => [
    {
      // Proxy browser Supabase requests through Next.js server
      source: "/supabase-proxy/:path*",
      destination: `${process.env.SUPABASE_URL || "http://supabase-kong:8000"}/:path*`,
    },
    {
      // Proxy external n8n webhook calls through the app's single endpoint
      // External services hit /n8n-webhook/* → server forwards to internal n8n
      source: "/n8n-webhook/:path*",
      destination: `${process.env.N8N_API_URL || "http://n8n-n8n-1:5678"}/webhook/:path*`,
    },
  ],
};

export default nextConfig;
