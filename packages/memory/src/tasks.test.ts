import { describe, expect, it } from "vitest";
import { createMemoryStore, type MemoryStore } from "./index.js";

function createWorker(store: MemoryStore, displayName: string, extraCapabilities: string[] = []) {
  return store.registerWorker({
    displayName,
    environment: "local",
    hostName: `${displayName.toLowerCase()}-host`,
    os: "test-os",
    capabilities: [
      {
        name: "worker.status",
        risk: "low",
        readOnly: true,
        requiresConfirmation: false,
        allowedScopes: ["self"]
      },
      {
        name: "agent.execute",
        risk: "medium",
        readOnly: false,
        requiresConfirmation: false,
        allowedScopes: ["approved_paths"]
      },
      ...extraCapabilities.map((name) => ({
        name,
        risk: "low" as const,
        readOnly: true,
        requiresConfirmation: false,
        allowedScopes: ["self"]
      }))
    ],
    pathScopes: []
  });
}

describe("task lifecycle (cross-device continuation)", () => {
  it("creates a task, runs it on one worker, pauses with handoff, and resumes on another worker", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const office = createWorker(store, "Office laptop");
    const home = createWorker(store, "Home server");

    const task = store.createTask({
      goal: "Draft the quarterly report",
      context: "Use the sales figures from the shared spreadsheet."
    });
    expect(task.status).toBe("pending");

    // Office laptop claims the task and starts working.
    const claimedByOffice = store.claimNextTask(office.id);
    expect(claimedByOffice?.id).toBe(task.id);
    expect(claimedByOffice?.assignedWorkerId).toBe(office.id);
    expect(claimedByOffice?.status).toBe("assigned");

    store.markTaskRunning(office.id, task.id);
    store.appendTaskCheckpoint(task.id, {
      workerId: office.id,
      kind: "progress",
      summary: "file_read: read sales-figures.xlsx (12,400 bytes)",
      payload: { tool: "file_read" }
    });
    store.appendTaskCheckpoint(task.id, {
      workerId: office.id,
      kind: "progress",
      summary: "file_write: wrote draft-report.md (3,200 bytes)",
      payload: { tool: "file_write" }
    });
    store.recordTaskArtifact(task.id, {
      name: "draft-report.md",
      mimeType: "text/markdown",
      sizeBytes: 3200,
      storagePath: `/tmp/sedna-artifacts/${task.id}/draft-report.md`
    });

    // Owner pauses before leaving the office.
    const paused = store.pauseTask(task.id);
    expect(paused.status).toBe("paused");
    expect(paused.assignedWorkerId).toBeUndefined();
    expect(paused.handoffSummary).toContain("Draft the quarterly report");
    expect(paused.handoffSummary).toContain("file_write");
    expect(paused.handoffSummary).toContain("[Office laptop]");

    // Home server claims the paused task after resume.
    store.resumeTask(task.id);
    const claimedByHome = store.claimNextTask(home.id);
    expect(claimedByHome?.id).toBe(task.id);
    expect(claimedByHome?.assignedWorkerId).toBe(home.id);

    // Resume context is available through checkpoints.
    const checkpoints = store.listTaskCheckpoints(task.id);
    expect(checkpoints.map((checkpoint) => checkpoint.workerId)).toEqual([office.id, office.id]);
    expect(store.getTask(task.id)?.handoffSummary).toContain("Resume instructions");

    store.markTaskRunning(home.id, task.id);
    store.appendTaskCheckpoint(task.id, {
      workerId: home.id,
      kind: "progress",
      summary: "file_write: finalized quarterly-report.md",
      payload: { tool: "file_write" }
    });
    const completed = store.completeTask(home.id, task.id, {
      success: true,
      summary: "Quarterly report finished with charts."
    });
    expect(completed.status).toBe("completed");
    expect(completed.result?.summary).toBe("Quarterly report finished with charts.");
    expect(completed.completedAt).toBeDefined();

    // Artifacts survived the handoff.
    expect(store.listTaskArtifacts(task.id).map((artifact) => artifact.name)).toEqual(["draft-report.md"]);

    // Full lifecycle visible on the timeline.
    expect(store.listEvents().map((event) => event.type)).toEqual(expect.arrayContaining([
      "task.created",
      "task.assigned",
      "task.started",
      "task.checkpoint",
      "task.paused",
      "task.resumed",
      "task.completed",
      "task.artifact.created"
    ]));
  });

  it("routes tasks by capability needs", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const plain = createWorker(store, "Plain laptop");
    const render = createWorker(store, "Render workstation", ["video.render"]);

    // Task requires a capability the plain worker lacks.
    const renderTask = store.createTask({
      goal: "Render the product demo video",
      needs: [{ capability: "video.render", optional: false }]
    });
    expect(store.claimNextTask(plain.id)).toBeUndefined();
    const claimedByRender = store.claimNextTask(render.id);
    expect(claimedByRender?.id).toBe(renderTask.id);

    // Unqualified need blocks every worker.
    const impossibleTask = store.createTask({
      goal: "Impossible task",
      needs: [{ capability: "quantum.compute", optional: false }]
    });
    expect(store.claimNextTask(render.id)).toBeUndefined();
    expect(store.listTasks({ status: "pending" }).map((task) => task.id)).toContain(impossibleTask.id);

    // Optional needs never block claiming.
    const flexibleTask = store.createTask({
      goal: "Summarize documents",
      needs: [{ capability: "gpu.inference", optional: true }]
    });
    expect(store.claimNextTask(plain.id)?.id).toBe(flexibleTask.id);
  });

  it("fails a task with error and allows resume from failed state", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = createWorker(store, "Office laptop");

    const task = store.createTask({ goal: "Run the CI pipeline" });
    store.claimNextTask(worker.id);
    store.markTaskRunning(worker.id, task.id);
    store.appendTaskCheckpoint(task.id, {
      workerId: worker.id,
      kind: "note",
      summary: "Build reached 80% before network outage."
    });
    const failed = store.failTask(worker.id, task.id, "Network unreachable");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Network unreachable");

    const resumed = store.resumeTask(task.id);
    expect(resumed.status).toBe("pending");
    expect(resumed.error).toBeUndefined();
    expect(resumed.handoffSummary).toBeUndefined();
  });

  it("rejects checkpoint and completion from workers that do not own the task", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const workerA = createWorker(store, "Worker A");
    const workerB = createWorker(store, "Worker B");

    const task = store.createTask({ goal: "Owned task" });
    store.claimNextTask(workerA.id);

    expect(() => store.appendTaskCheckpoint(task.id, {
      workerId: workerB.id,
      kind: "progress",
      summary: "should not be allowed"
    })).toThrow(/not assigned/i);
    expect(() => store.completeTask(workerB.id, task.id, { success: true })).toThrow(/not assigned/i);
    expect(() => store.markTaskRunning(workerB.id, task.id)).toThrow(/not assigned/i);
  });

  it("cancels a task and lists it by status", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const task = store.createTask({ goal: "Soon-cancelled task" });
    expect(store.listTasks({ status: "pending" }).map((item) => item.id)).toContain(task.id);
    expect(store.cancelTask(task.id).status).toBe("cancelled");
    expect(store.listTasks({ status: "pending" })).toHaveLength(0);
    expect(store.listTasks({ status: "cancelled" }).map((item) => item.id)).toEqual([task.id]);
  });
});
