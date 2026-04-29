import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { processEmbeddingQueue } from "@/lib/rag";
import {
  createMockSupabaseClient,
  mockProfile,
  mockUser,
} from "@/__tests__/mocks/supabase";
import { createJsonRequest, getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);
const mockProcessEmbeddingQueue = vi.mocked(processEmbeddingQueue);

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function createQueryChain(result: QueryResult) {
  const chain = {
    data: result.data,
    error: result.error,
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => result),
  };
  return chain;
}

function setupClient(options: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
} = {}) {
  const client = createMockSupabaseClient({
    user: options.user === undefined ? mockUser : options.user,
  });
  const profile = options.profile === undefined ? mockProfile : options.profile;
  const profileChain = createQueryChain({ data: profile, error: null });

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") return profileChain as never;
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return { profileChain };
}

describe("POST /api/rag/embed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupClient();
    mockProcessEmbeddingQueue.mockResolvedValue({ processed: 0, failed: 0 });
  });

  it("should require an authenticated user rather than a cron secret", async () => {
    setupClient({ user: null });
    const request = createJsonRequest("http://localhost/api/rag/embed", {});

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockProcessEmbeddingQueue).not.toHaveBeenCalled();
  });

  it("should return 404 when tenant profile is missing", async () => {
    setupClient({ profile: null });
    const request = createJsonRequest("http://localhost/api/rag/embed", {});

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
    expect(mockProcessEmbeddingQueue).not.toHaveBeenCalled();
  });

  it("should return an empty queue result", async () => {
    mockProcessEmbeddingQueue.mockResolvedValue({ processed: 0, failed: 0 });
    const request = createJsonRequest("http://localhost/api/rag/embed", {});

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { processed: 0, failed: 0 } });
    expect(mockProcessEmbeddingQueue).toHaveBeenCalledWith("tenant-456");
  });

  it("should return partial failures from the queue worker without treating them as route errors", async () => {
    mockProcessEmbeddingQueue.mockResolvedValue({ processed: 3, failed: 1 });
    const request = createJsonRequest("http://localhost/api/rag/embed", {});

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { processed: 3, failed: 1 } });
  });

  it("should return successful queue processing results", async () => {
    const { profileChain } = setupClient();
    mockProcessEmbeddingQueue.mockResolvedValue({ processed: 5, failed: 0 });
    const request = createJsonRequest("http://localhost/api/rag/embed", {});

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { processed: 5, failed: 0 } });
    expect(profileChain.eq).toHaveBeenCalledWith("id", "user-123");
    expect(mockProcessEmbeddingQueue).toHaveBeenCalledWith("tenant-456");
  });

  it("should propagate processEmbeddingQueue errors", async () => {
    mockProcessEmbeddingQueue.mockRejectedValue(new Error("embedding provider down"));
    const request = createJsonRequest("http://localhost/api/rag/embed", {});

    const response = await POST(request);
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("embedding provider down");
  });
});
