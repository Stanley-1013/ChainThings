import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createMockSupabaseClient, mockProfile } from "@/__tests__/mocks/supabase";
import { getJsonResponse } from "@/__tests__/helpers";

const mockCreateClient = vi.mocked(createClient);

const BASE_URL = "http://localhost:3000/api/files/upload";

function createFileRequest(file?: File): Request {
  const formData = new FormData();
  if (file) {
    formData.append("file", file);
  }
  return new Request(BASE_URL, {
    method: "POST",
    body: formData,
  });
}

function setupUploadClient(options?: {
  uploadError?: string | null;
  metaData?: Record<string, unknown> | null;
  metaError?: string | null;
}) {
  const client = createMockSupabaseClient();

  client.storage.from = vi.fn(() => ({
    upload: vi.fn(() => ({
      error: options?.uploadError ? { message: options.uploadError } : null,
    })),
  }));

  const fileMeta = options?.metaData ?? {
    id: "file-1",
    tenant_id: "tenant-456",
    filename: "test.txt",
    storage_path: "tenant-456/123-test.txt",
    content_type: "text/plain",
    size_bytes: 100,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };

  client.from = vi.fn((table: string) => {
    if (table === "chainthings_profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({ data: mockProfile, error: null })),
          })),
        })),
      } as never;
    }
    if (table === "chainthings_files") {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => ({
              data: fileMeta,
              error: options?.metaError ? { message: options.metaError } : null,
            })),
          })),
        })),
      } as never;
    }
    return {} as never;
  });

  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

describe("POST /api/files/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated user", async () => {
    const client = createMockSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as never);

    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const response = await POST(createFileRequest(file));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 404 when profile not found", async () => {
    const client = createMockSupabaseClient({ profile: null });
    mockCreateClient.mockResolvedValue(client as never);

    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const response = await POST(createFileRequest(file));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  it("should return 400 when no file provided", async () => {
    setupUploadClient();

    const response = await POST(createFileRequest());
    const body = await getJsonResponse(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("No file provided");
  });

  it("should upload file and return metadata", async () => {
    setupUploadClient();

    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const response = await POST(createFileRequest(file));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.file.filename).toBe("test.txt");
    expect(body.file.tenant_id).toBe("tenant-456");
  });

  it("should return 500 when storage upload fails", async () => {
    setupUploadClient({ uploadError: "Storage full" });

    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const response = await POST(createFileRequest(file));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Storage full");
  });

  it("should return 500 when metadata insert fails", async () => {
    setupUploadClient({ metaError: "DB error" });

    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const response = await POST(createFileRequest(file));
    const body = await getJsonResponse(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("DB error");
  });
});
