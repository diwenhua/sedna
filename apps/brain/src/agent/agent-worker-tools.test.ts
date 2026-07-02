import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { buildWorkerAgentToolDefinitions, executeWorkerDispatchTask } from "./agent-worker-tools.js";

describe("worker dispatch tools", () => {
  it("registers worker_dispatch_task when an online worker supports agent.execute", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local Worker",
      environment: "local",
      capabilities: [
        {
          name: "agent.execute",
          risk: "medium",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"]
        }
      ],
      pathScopes: [
        { label: "project", path: "/tmp/sedna-worker", mode: "read_only", enabled: true }
      ]
    });
    store.heartbeatWorker(worker.id, { pid: 1 });

    const tools = buildWorkerAgentToolDefinitions(store);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("worker_dispatch_task");
  });

  it("dispatches agent.execute jobs to the selected worker", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local Worker",
      environment: "local",
      capabilities: [
        {
          name: "agent.execute",
          risk: "medium",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"]
        }
      ],
      pathScopes: [
        { label: "project", path: "/tmp/sedna-worker", mode: "read_only", enabled: true }
      ]
    });
    store.heartbeatWorker(worker.id, { pid: 1 });

    const pump = setInterval(() => {
      for (const job of store.listWorkerJobs({ workerId: worker.id, status: "queued" })) {
        store.startWorkerJob(worker.id, job.id);
        store.completeWorkerJob(worker.id, job.id, {
          success: true,
          summary: "Listed project root",
          answer: "README.md is present.",
          steps: [{ tool: "file_list", summary: "1 entry" }]
        });
      }
    }, 5);

    try {
      const result = await executeWorkerDispatchTask(store, {
        goal: "List files under /tmp/sedna-worker"
      });
      expect(result).toMatchObject({
        success: true,
        worker_id: worker.id,
        capability: "agent.execute",
        answer: "README.md is present."
      });
      expect(store.listWorkerJobs({ workerId: worker.id })[0]).toMatchObject({
        capability: "agent.execute",
        input: { goal: "List files under /tmp/sedna-worker" }
      });
    } finally {
      clearInterval(pump);
      store.close();
    }
  });
});
