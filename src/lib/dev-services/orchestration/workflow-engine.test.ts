import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase admin mock ────────────────────────────────────────────────────
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// ── Internal dependency mocks (not under test) ─────────────────────────────
vi.mock("../factory", () => ({
  createDevServiceClient: vi.fn(),
}));

vi.mock("./linker", () => ({
  createServiceLink: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase/admin";
import { executeWorkflow } from "./workflow-engine";

const mockFrom = vi.mocked(supabaseAdmin.from);

// ── Builder helpers ────────────────────────────────────────────────────────

/**
 * Build the insert().select().single() chain that returns on the FIRST call
 * to supabaseAdmin.from() for the workflow test.
 */
function makeInsertChain(data: unknown, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  return { insert, _single: single };
}

/**
 * Build the select().eq().eq().single() chain used when fetching an existing
 * row after a 23505 conflict.
 */
function makeSelectEqEqSingleChain(data: unknown, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const eq2 = vi.fn(() => ({ single }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  return { select, _single: single };
}

/**
 * Build the select().eq().single() chain used during the polling loop (by id).
 */
function makeSelectEqSingleChain(data: unknown) {
  const single = vi.fn().mockResolvedValue({ data, error: null });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return { select, _single: single };
}

/**
 * Build the update().eq() chain used to persist the final step_results.
 */
function makeUpdateChain() {
  const eq = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn(() => ({ eq }));
  return { update };
}

// ── Common test fixtures ───────────────────────────────────────────────────
const TENANT = "tenant-abc";
const WORKFLOW = "sprint_summary"; // no external service calls needed for summary; but we must also mock the engines/summary import
const INPUT: Record<string, string> = { project: "PROJ" };
const IDEM_KEY = "idempotency-key-001";
const EXEC_ID = "exec-id-999";

// ── Test suite ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("executeWorkflow — idempotency race-safe logic", () => {
  it("1. Insert success → runs workflow, returns steps", async () => {
    // First call: insert().select().single() — success
    const insertChain = makeInsertChain({ id: EXEC_ID });
    // Second call: update().eq() — final status write
    const updateChain = makeUpdateChain();

    // Mock for sprint_summary: the _ai step calls engines/summary
    vi.doMock("../engines/summary", () => ({
      generateSprintSummary: vi.fn().mockResolvedValue({ markdown: "# Summary" }),
      cacheSummary: vi.fn().mockResolvedValue(undefined),
    }));

    // Also need to mock jira list_issues for the first step of sprint_summary
    vi.mock("../factory", () => ({
      createDevServiceClient: vi.fn().mockResolvedValue({
        asWorkItemTracker: vi.fn(() => ({
          listIssues: vi.fn().mockResolvedValue([]),
        })),
        asCodeHost: vi.fn(() => null),
      }),
    }));

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return { insert: insertChain.insert } as never;
      // subsequent calls are the update
      return { update: updateChain.update } as never;
    });

    const result = await executeWorkflow(TENANT, WORKFLOW, INPUT, undefined, undefined);

    expect(result).toHaveProperty("steps");
    expect(Array.isArray(result.steps)).toBe(true);
    // Insert was called with status='running'
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT, status: "running" }),
    );
    // Final update was called
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.stringMatching(/^(completed|failed)$/) }),
    );
  });

  it("2. 23505 conflict with existing completed row → returns cached step_results immediately", async () => {
    const cachedSteps = [{ id: "issues", status: "completed", result: { items: [] } }];

    // First from() call → insert → 23505 error
    const insertErr = { code: "23505", message: "unique_violation" };
    const insertChain = makeInsertChain(null, insertErr);

    // Second from() call → select existing row (completed)
    const existingRow = { id: "existing-exec", status: "completed", step_results: cachedSteps };
    const selectChain = makeSelectEqEqSingleChain(existingRow);

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return { insert: insertChain.insert } as never;
      return { select: selectChain.select } as never;
    });

    const result = await executeWorkflow(TENANT, WORKFLOW, INPUT, undefined, IDEM_KEY);

    expect(result.steps).toEqual(cachedSteps);
    // Should NOT have called update (no workflow ran)
    expect(callIndex).toBe(2);
  });

  it("3. 23505 conflict with existing failed row → returns failed step_results immediately", async () => {
    const failedSteps = [{ id: "issues", status: "failed", error: "jira unreachable" }];

    const insertErr = { code: "23505", message: "unique_violation" };
    const insertChain = makeInsertChain(null, insertErr);

    const existingRow = { id: "existing-exec-fail", status: "failed", step_results: failedSteps };
    const selectChain = makeSelectEqEqSingleChain(existingRow);

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return { insert: insertChain.insert } as never;
      return { select: selectChain.select } as never;
    });

    const result = await executeWorkflow(TENANT, WORKFLOW, INPUT, undefined, IDEM_KEY);

    expect(result.steps).toEqual(failedSteps);
    expect(callIndex).toBe(2);
  });

  it("4. 23505 conflict with running row → becomes completed after 1 poll", async () => {
    vi.useFakeTimers();

    const completedSteps = [{ id: "issues", status: "completed", result: {} }];

    // Call 1: insert → 23505
    const insertErr = { code: "23505", message: "unique_violation" };
    const singleInsert = vi.fn().mockResolvedValue({ data: null, error: insertErr });
    const selectInsert = vi.fn(() => ({ single: singleInsert }));
    const insert = vi.fn(() => ({ select: selectInsert }));

    // Call 2: select existing row (still running)
    const runningRow = { id: "running-exec", status: "running", step_results: [] };
    const singleExisting = vi.fn().mockResolvedValue({ data: runningRow, error: null });
    const eq2Existing = vi.fn(() => ({ single: singleExisting }));
    const eq1Existing = vi.fn(() => ({ eq: eq2Existing }));
    const selectExisting = vi.fn(() => ({ eq: eq1Existing }));

    // Call 3 (poll by id): row now completed
    const singlePoll = vi.fn().mockResolvedValue({
      data: { status: "completed", step_results: completedSteps },
      error: null,
    });
    const eqPoll = vi.fn(() => ({ single: singlePoll }));
    const selectPoll = vi.fn(() => ({ eq: eqPoll }));

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return { insert } as never;
      if (callIndex === 2) return { select: selectExisting } as never;
      return { select: selectPoll } as never;
    });

    // Start the executeWorkflow call — it will pause at setTimeout
    const promise = executeWorkflow(TENANT, WORKFLOW, INPUT, undefined, IDEM_KEY);

    // Advance the 1s poll interval
    await vi.advanceTimersByTimeAsync(1_100);

    const result = await promise;

    expect(result.steps).toEqual(completedSteps);
    // Poll happened exactly once
    expect(selectPoll).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("5. 23505 conflict with running row → 30s timeout → throws", async () => {
    vi.useFakeTimers();

    // Call 1: insert → 23505
    const insertErr = { code: "23505", message: "unique_violation" };
    const singleInsert = vi.fn().mockResolvedValue({ data: null, error: insertErr });
    const selectInsert = vi.fn(() => ({ single: singleInsert }));
    const insert = vi.fn(() => ({ select: selectInsert }));

    // Call 2: select existing row (always running)
    const runningRow = { id: "stuck-exec", status: "running", step_results: [] };
    const singleExisting = vi.fn().mockResolvedValue({ data: runningRow, error: null });
    const eq2Existing = vi.fn(() => ({ single: singleExisting }));
    const eq1Existing = vi.fn(() => ({ eq: eq2Existing }));
    const selectExisting = vi.fn(() => ({ eq: eq1Existing }));

    // Subsequent poll calls always return running
    const singlePoll = vi.fn().mockResolvedValue({
      data: { status: "running", step_results: [] },
      error: null,
    });
    const eqPoll = vi.fn(() => ({ single: singlePoll }));
    const selectPoll = vi.fn(() => ({ eq: eqPoll }));

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return { insert } as never;
      if (callIndex === 2) return { select: selectExisting } as never;
      return { select: selectPoll } as never;
    });

    // Attach rejection handler immediately so the promise is never "unhandled"
    const promise = executeWorkflow(TENANT, WORKFLOW, INPUT, undefined, IDEM_KEY);
    const caught = promise.catch((e: Error) => e);

    // Advance past the 30s poll window (30 poll ticks of 1s each)
    await vi.advanceTimersByTimeAsync(31_000);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/execution in progress.*Retry later/i);

    vi.useRealTimers();
  });
});
