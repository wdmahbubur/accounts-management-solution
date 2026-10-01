import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const raw = execFileSync("supabase", ["status", "-o", "json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
});
const status = JSON.parse(raw);

const pick = (...keys) => {
  for (const key of keys) {
    if (typeof status[key] === "string" && status[key].length > 0) {
      return status[key];
    }
  }
  throw new Error(
    `Missing Supabase status key: ${keys.join("/")}; available keys: ${Object.keys(status).join(", ")}`
  );
};

const url = pick("API_URL", "api_url", "PROJECT_URL", "project_url");
const publishable = pick(
  "PUBLISHABLE_KEY",
  "publishable_key",
  "ANON_KEY",
  "anon_key"
);

if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Test environment export requires an isolated loopback stack.");
}
const invitationKey = randomBytes(32).toString("hex");
process.stderr.write(`::add-mask::${invitationKey}\n`);
process.stdout.write(
  [
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
    "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000",
    `INVITATION_DELIVERY_KEY=${invitationKey}`
  ].join("\n") + "\n"
);
