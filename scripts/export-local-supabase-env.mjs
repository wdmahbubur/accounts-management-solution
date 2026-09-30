import { execFileSync } from "node:child_process";

const raw = execFileSync("supabase", ["status", "-o", "json"], {
  encoding: "utf8"
});
const status = JSON.parse(raw);

const pick = (...keys) => {
  for (const key of keys) {
    if (typeof status[key] === "string" && status[key].length > 0) {
      return status[key];
    }
  }
  throw new Error(`Missing Supabase status key: ${keys.join("/")}`);
};

const url = pick("API_URL", "api_url", "PROJECT_URL", "project_url");
const publishable = pick(
  "PUBLISHABLE_KEY",
  "publishable_key",
  "ANON_KEY",
  "anon_key"
);

process.stdout.write(
  [
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
    "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000"
  ].join("\n") + "\n"
);
