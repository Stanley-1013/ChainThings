import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  next: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: mocks.next,
    redirect: mocks.redirect,
  },
}));

import { createServerClient } from "@supabase/ssr";
import { middleware } from "../middleware";

const mockCreateServerClient = vi.mocked(createServerClient);

function requestFor(path: string, cookieNames: string[] = []) {
  const url = new URL(`http://localhost:3000${path}`);
  const request = {
    nextUrl: {
      pathname: url.pathname,
      clone: vi.fn(() => new URL(url.toString())),
    },
    cookies: {
      getAll: vi.fn(() => cookieNames.map((name) => ({ name, value: "token" }))),
      set: vi.fn(),
    },
  };
  return request as never;
}

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.next.mockImplementation(() => ({ type: "next", cookies: { set: vi.fn() } }));
    mocks.redirect.mockImplementation((url: URL) => ({ type: "redirect", url: url.toString() }));
  });

  it.each([
    "/login",
    "/register",
    "/callback",
    "/api/webhooks/hedy",
    "/api/dev-services/webhooks/github/integration-1",
    "/api/dev-services/worker",
  ])("bypasses auth redirect for public path %s", async (path) => {
    const response = await middleware(requestFor(path));

    expect(response).toEqual({ type: "next", cookies: expect.any(Object) });
    expect(mocks.next).toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/login" })
    );
  });

  it("redirects protected paths to login when no auth cookie exists", async () => {
    const response = await middleware(requestFor("/dashboard"));

    expect(response).toEqual({
      type: "redirect",
      url: "http://localhost:3000/login",
    });
    expect(mockCreateServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("allows protected paths when an auth cookie has a valid Supabase user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await middleware(
      requestFor("/dashboard", ["sb-test-auth-token"])
    );

    expect(response).toEqual({ type: "next", cookies: expect.any(Object) });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("accepts chunked Supabase auth cookies", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    await middleware(requestFor("/items", ["sb-test-auth-token.0"]));

    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects protected paths when the auth cookie is present but getUser returns null", async () => {
    const response = await middleware(
      requestFor("/dashboard", ["sb-test-auth-token"])
    );

    expect(response).toEqual({
      type: "redirect",
      url: "http://localhost:3000/login",
    });
  });

  it("redirects authenticated users away from public auth pages", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await middleware(
      requestFor("/login", ["sb-test-auth-token"])
    );

    expect(response).toEqual({
      type: "redirect",
      url: "http://localhost:3000/dashboard",
    });
  });
});
