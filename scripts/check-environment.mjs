import { loadEnvFile } from "node:process";
import { checkEnvironment, formatEnvironmentCheck } from "./environment-config.mjs";

const help = `Usage: npm run env:check -- --local | --preview

  --local    Load .env.local if present, preserving injected environment values.
  --preview  Read only injected environment; never load local environment files.
  --help     Show this help without reading configuration.

Required for this demo-auth readiness check:
  AUTH_URL and NEXT_PUBLIC_APP_URL: the same canonical browser origin.
  AUTH_SECRET: an independent server-only secret from at least 32 random bytes.
  DATABASE_RUNTIME_URL: a restricted PostgreSQL application connection.

Local HTTP is allowed only on loopback hosts. Preview requires HTTPS.
Mail, worker and attachment settings are not required for preverified demo login.
No values are printed and no services are contacted. This command does not run
as part of build or check; run it separately in the intended environment.
See docs/environment-readiness.md for setup and runtime acceptance checks.
`;

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(help);
} else if (args.length !== 1 || !["--local", "--preview"].includes(args[0])) {
  process.stderr.write("Choose exactly one environment mode. Configuration values must not be passed as command arguments.\n" + help);
  process.exitCode = 2;
} else {
  const mode = args[0].slice(2);
  let canCheck = true;
  if (mode === "local") {
    try {
      loadEnvFile(".env.local");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        process.stderr.write("Could not load .env.local. Check that the private configuration file is readable and valid. No file contents are printed.\n");
        process.exitCode = 1;
        canCheck = false;
      }
    }
  }
  if (canCheck) {
    const result = checkEnvironment(process.env, mode);
    process.stdout.write(formatEnvironmentCheck(result));
    process.exitCode = result.errors.length ? 1 : 0;
  }
}
