import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildBrainServer } from "./server.js";
import { parsePort, readEnv } from "@sedna/shared";

const dbPath = readEnv("SEDNA_DB_PATH", "apps/brain/data/sedna.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

const app = buildBrainServer({ logger: true });
const port = parsePort(process.env.PORT, 8787);
const host = readEnv("HOST", "127.0.0.1");

await app.listen({ port, host });
