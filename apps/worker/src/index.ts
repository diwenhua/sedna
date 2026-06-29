#!/usr/bin/env node
import type { Capability } from "@sedna/protocol";

const now = new Date().toISOString();

const mockCapabilities: Capability[] = [
  {
    id: "cap_worker_status",
    name: "worker.status",
    risk: "low",
    readOnly: true,
    requiresConfirmation: false,
    allowedScopes: ["self"],
    inputSchema: {},
    outputSchema: {},
    createdAt: now
  }
];

const command = process.argv[2] ?? "status";

if (command === "capabilities") {
  console.log(JSON.stringify(mockCapabilities, null, 2));
} else if (command === "status") {
  console.log(JSON.stringify({
    name: "@sedna/worker",
    mode: "mock-only",
    execution: "disabled",
    capabilities: mockCapabilities.map((capability) => capability.name)
  }, null, 2));
} else {
  console.error("Sedna worker MVP only supports: status, capabilities");
  process.exitCode = 1;
}
