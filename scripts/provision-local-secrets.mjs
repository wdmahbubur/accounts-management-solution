import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import "./load-local-env.mjs";

if (process.env.NODE_ENV === "production") throw new Error("This helper provisions local development only.");
const path = ".env.local";
let contents = await readFile(path, "utf8");
const required = [
  ["AUTH_SECRET", () => randomBytes(32).toString("base64url")],
  ["INVITATION_DELIVERY_KEY", () => randomBytes(32).toString("hex")],
  ["OUTBOX_WORKER_SECRET", () => randomBytes(32).toString("base64url")],
  ["EXPORT_WORKER_SECRET", () => randomBytes(32).toString("base64url")]
];
const added = [];
for (const [key, generate] of required) {
  const line = new RegExp(`^${key}=(.*)$`, "m").exec(contents);
  if (line && line[1].trim()) continue;
  const value = generate();
  if (line) contents = contents.replace(line[0], `${key}=${value}`);
  else contents = `${contents.replace(/\s*$/, "\n")}${key}=${value}\n`;
  added.push(key);
}
if (added.length) await writeFile(path, contents, { mode: 0o600 });
process.stdout.write(added.length ? `Generated local secrets: ${added.join(", ")}.\n` : "Required local secrets are already configured.\n");
