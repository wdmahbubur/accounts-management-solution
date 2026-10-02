import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import "./load-local-env.mjs";

const next = resolve("node_modules/next/dist/bin/next");
const result = spawnSync(process.execPath, [next, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
