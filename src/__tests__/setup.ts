import { vi } from "vitest";

// Set test environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:8000";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_COOKIE_NAME = "sb-test-auth-token";
process.env.OPENCLAW_GATEWAY_URL = "http://localhost:18789";
process.env.OPENCLAW_GATEWAY_TOKEN = "test-token";
process.env.N8N_API_URL = "http://localhost:5678";
process.env.N8N_API_KEY = "test-n8n-key";
process.env.SUPABASE_URL = "http://localhost:8000";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: vi.fn(() => []),
    set: vi.fn(),
  })),
}));

// Mock @/lib/supabase/server
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Mock @/lib/openclaw/client
vi.mock("@/lib/openclaw/client", () => ({
  chatCompletion: vi.fn(),
}));

// Mock @/lib/n8n/client
vi.mock("@/lib/n8n/client", () => ({
  createWorkflow: vi.fn(),
  activateWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
}));

// Mock @/lib/n8n/templates/hedy-webhook
vi.mock("@/lib/n8n/templates/hedy-webhook", () => ({
  generateHedyWebhookWorkflow: vi.fn(),
}));
