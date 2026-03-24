import { vi } from "vitest";

// Mock next/server after() — execute callback synchronously in tests
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn((cb: () => void) => { cb(); }) };
});

// Set test environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:8000";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_COOKIE_NAME = "sb-test-auth-token";
process.env.ZEROCLAW_GATEWAY_URL = "http://localhost:42617";
process.env.ZEROCLAW_GATEWAY_TOKEN = "test-zc-token";
process.env.OPENCLAW_GATEWAY_URL = "http://localhost:18789";
process.env.OPENCLAW_GATEWAY_TOKEN = "test-token";
process.env.N8N_API_URL = "http://localhost:5678";
process.env.N8N_API_KEY = "test-n8n-key";
process.env.SUPABASE_URL = "http://localhost:8000";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.CHAINTHINGS_WEBHOOK_SECRET = "test-webhook-secret";

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

// Mock @/lib/ai-gateway
vi.mock("@/lib/ai-gateway", () => ({
  chatCompletion: vi.fn(),
  buildZeroClawPrompt: vi.fn(),
  getDefaultProvider: vi.fn(() => "zeroclaw"),
  getProviderConfig: vi.fn(),
}));

// Mock @/lib/openclaw/client (deprecated re-export)
vi.mock("@/lib/openclaw/client", () => ({
  chatCompletion: vi.fn(),
}));

// Mock @/lib/n8n/client
vi.mock("@/lib/n8n/client", () => ({
  createWorkflow: vi.fn(),
  getWorkflow: vi.fn(),
  activateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
  getWorkflowEditorUrl: vi.fn(() => null),
}));

// Mock @/lib/n8n/validation
vi.mock("@/lib/n8n/validation", () => ({
  validateWorkflowNodes: vi.fn(() => ({ valid: true, disallowed: [] })),
}));

// Mock @/lib/n8n/templates/hedy-webhook
vi.mock("@/lib/n8n/templates/hedy-webhook", () => ({
  generateHedyWebhookWorkflow: vi.fn(),
}));

// Mock @/lib/rag/worker
vi.mock("@/lib/rag/worker", () => ({
  triggerEmbedding: vi.fn(),
  processEmbeddingQueue: vi.fn(() => ({ processed: 0, failed: 0 })),
}));

// Mock @/lib/memory/extractor
vi.mock("@/lib/memory/extractor", () => ({
  shouldExtractMemory: vi.fn(() => false),
  extractAndSaveMemories: vi.fn(),
}));
