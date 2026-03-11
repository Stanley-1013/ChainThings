import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createMockSupabaseClient } from "@/__tests__/mocks/supabase";

const mockCreateClient = vi.mocked(createClient);

describe("POST /api/auth/signout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call signOut and redirect to /login with 302", async () => {
    const mockClient = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(mockClient as never);

    const request = new Request("http://localhost:3000/api/auth/signout", {
      method: "POST",
    });

    const response = await POST(request);

    expect(mockClient.auth.signOut).toHaveBeenCalledOnce();
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("should call signOut exactly once", async () => {
    const mockClient = createMockSupabaseClient();
    mockCreateClient.mockResolvedValue(mockClient as never);

    const request = new Request("http://localhost:3000/api/auth/signout", {
      method: "POST",
    });

    await POST(request);

    expect(mockClient.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
