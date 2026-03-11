import { vi } from "vitest";

export const mockUser = {
  id: "user-123",
  email: "test@example.com",
  aud: "authenticated",
  role: "authenticated",
};

export const mockProfile = {
  tenant_id: "tenant-456",
};

type ChainFn = ReturnType<typeof vi.fn> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function createChainMock(resolveData: unknown = null, resolveError: unknown = null): ChainFn {
  const result = { data: resolveData, error: resolveError };
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  const methods = ["select", "eq", "single", "order", "limit", "insert", "upsert", "update", "delete"];
  for (const method of methods) {
    chain[method] = vi.fn(() => ({ ...chain, ...result }));
  }

  return chain as unknown as ChainFn;
}

export interface MockSupabaseClient {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
}

export function createMockSupabaseClient(options?: {
  user?: typeof mockUser | null;
  profile?: typeof mockProfile | null;
  profileError?: unknown;
}): MockSupabaseClient {
  const user = options?.user !== undefined ? options.user : mockUser;
  const profile = options?.profile !== undefined ? options.profile : mockProfile;

  return {
    auth: {
      getUser: vi.fn(() => ({ data: { user } })),
      signOut: vi.fn(() => ({})),
    },
    from: vi.fn((table: string) => {
      if (table === "chainthings_profiles") {
        return createChainMock(profile, options?.profileError || null);
      }
      return createChainMock(null, null);
    }),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => ({ error: null })),
      })),
    },
  };
}

export function mockFromTable(
  client: MockSupabaseClient,
  table: string,
  data: unknown,
  error: unknown = null,
) {
  const original = client.from;
  client.from = vi.fn((t: string) => {
    if (t === table) return createChainMock(data, error);
    return (original as (t: string) => unknown)(t);
  });
}
