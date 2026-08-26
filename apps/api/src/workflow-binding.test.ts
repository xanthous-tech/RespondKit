import { describe, expect, it, vi } from "vite-plus/test";

import { acceptWorkflow, isActiveWorkflow } from "./workflow-binding";
import type { MessageWorkflowEnvelope } from "./workflows/envelope";

const envelope: MessageWorkflowEnvelope = {
  schema: "respondkit.workflow-message/1",
  direction: "customer_to_operator",
  workspaceId: "workspace_test",
  inboxId: "inbox_test",
  threadId: "thread_test",
  visitorId: "visitor_test",
  messageId: "message_test",
  workflowInstanceId: "customer_workflow_test",
  acceptedAt: "2026-08-25T12:00:00.000Z",
  clientMessageId: "client_message_test",
  originalText: "မင်္ဂလာပါ",
  context: {},
};

function workflowBinding(input: {
  readonly createBatch: (
    batch: WorkflowInstanceCreateOptions<MessageWorkflowEnvelope>[],
  ) => Promise<WorkflowInstance[]> | WorkflowInstance[];
  readonly status?: InstanceStatus;
}): Workflow<MessageWorkflowEnvelope> {
  return {
    createBatch: input.createBatch,
    get: async () =>
      ({
        status: async () => input.status ?? { status: "running" },
      }) as WorkflowInstance,
  } as unknown as Workflow<MessageWorkflowEnvelope>;
}

describe("Workflow durable acceptance", () => {
  it("repeats only the identical deterministic createBatch item after ambiguity", async () => {
    const firstError = new Error("binding response was lost");
    const createBatch = vi
      .fn<
        (
          batch: WorkflowInstanceCreateOptions<MessageWorkflowEnvelope>[],
        ) => Promise<WorkflowInstance[]>
      >()
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce([{} as WorkflowInstance]);

    await expect(
      acceptWorkflow(workflowBinding({ createBatch }), envelope.workflowInstanceId, envelope),
    ).resolves.toEqual({ kind: "created" });
    expect(createBatch).toHaveBeenCalledTimes(2);
    for (const [batch] of createBatch.mock.calls) {
      expect(batch).toEqual([
        {
          id: envelope.workflowInstanceId,
          params: envelope,
          retention: { successRetention: "1 day", errorRetention: "3 days" },
        },
      ]);
      expect(batch[0]?.params).toBe(envelope);
    }
  });

  it("reconciles an empty duplicate batch with the retained instance status", async () => {
    const createBatch = vi.fn(async () => [] as WorkflowInstance[]);
    await expect(
      acceptWorkflow(
        workflowBinding({ createBatch, status: { status: "waiting" } }),
        envelope.workflowInstanceId,
        envelope,
      ),
    ).resolves.toEqual({ kind: "existing", status: { status: "waiting" } });
  });

  it("does not claim acceptance when both deterministic attempts remain ambiguous", async () => {
    const secondError = new Error("binding unavailable again");
    const createBatch = vi
      .fn<
        (
          batch: WorkflowInstanceCreateOptions<MessageWorkflowEnvelope>[],
        ) => Promise<WorkflowInstance[]>
      >()
      .mockRejectedValueOnce(new Error("binding unavailable"))
      .mockRejectedValueOnce(secondError);
    await expect(
      acceptWorkflow(workflowBinding({ createBatch }), envelope.workflowInstanceId, envelope),
    ).resolves.toEqual({ kind: "unknown", cause: secondError });
  });

  it("distinguishes active statuses from terminal or unavailable statuses", () => {
    expect(isActiveWorkflow("queued")).toBe(true);
    expect(isActiveWorkflow("waitingForPause")).toBe(true);
    expect(isActiveWorkflow("complete")).toBe(false);
    expect(isActiveWorkflow("errored")).toBe(false);
    expect(isActiveWorkflow("unknown")).toBe(false);
  });
});
