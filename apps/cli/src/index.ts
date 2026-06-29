#!/usr/bin/env node
import { readEnv } from "@sedna/shared";

const command = process.argv[2] ?? "help";
const brainUrl = readEnv("SEDNA_BRAIN_URL", "http://127.0.0.1:8787");

if (command === "help") {
  console.log(`Sedna CLI MVP

Commands:
  help      Show this help
  status    Print the configured Brain API URL

This MVP CLI does not implement worker pairing, local execution, or external actions.`);
} else if (command === "status") {
  console.log(JSON.stringify({ brainUrl, mode: "brain-api-client-skeleton" }, null, 2));
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}
