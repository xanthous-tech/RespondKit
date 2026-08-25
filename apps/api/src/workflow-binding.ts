import type { MessageWorkflowEnvelope } from "./workflows/envelope";

export type WorkflowStatusName =
  | "complete"
  | "errored"
  | "paused"
  | "queued"
  | "running"
  | "terminated"
  | "unknown"
  | "waiting"
  | "waitingForPause";

export interface WorkflowStatusSnapshot {
  readonly status: WorkflowStatusName;
  readonly error?: unknown;
}

export type WorkflowAcceptance =
  | { readonly kind: "created" }
  | { readonly kind: "existing"; readonly status: WorkflowStatusSnapshot }
  | { readonly kind: "unknown"; readonly cause: unknown };

const retention = {
  successRetention: "1 day",
  errorRetention: "3 days",
} as const;

export async function workflowStatus(
  binding: Workflow<MessageWorkflowEnvelope>,
  instanceId: string,
): Promise<WorkflowStatusSnapshot | null> {
  try {
    const instance = await binding.get(instanceId);
    return (await instance.status()) as WorkflowStatusSnapshot;
  } catch {
    return null;
  }
}

/** Repeats only the same deterministic createBatch call after ambiguity. */
export async function acceptWorkflow(
  binding: Workflow<MessageWorkflowEnvelope>,
  instanceId: string,
  params: MessageWorkflowEnvelope,
): Promise<WorkflowAcceptance> {
  let lastCause: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const created = await binding.createBatch([{ id: instanceId, params, retention }]);
      if (created.length > 0) return { kind: "created" };

      const status = await workflowStatus(binding, instanceId);
      return status === null || status.status === "unknown"
        ? { kind: "unknown", cause: new Error("Workflow status is unavailable") }
        : { kind: "existing", status };
    } catch (cause) {
      lastCause = cause;
    }
  }
  return { kind: "unknown", cause: lastCause };
}

export function isActiveWorkflow(status: WorkflowStatusName): boolean {
  return ["paused", "queued", "running", "waiting", "waitingForPause"].includes(status);
}
