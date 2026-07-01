import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrainServer } from "./server.js";
import { loadEnvFile, parsePort, readEnv } from "@sedna/shared";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvFile(resolve(repoRoot, ".env"));

const dbPath = readEnv("SEDNA_DB_PATH", "apps/brain/data/sedna.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

const app = await buildBrainServer({ logger: true });
const port = parsePort(process.env.PORT, 8787);
const host = readEnv("HOST", "127.0.0.1");

await app.listen({ port, host });
