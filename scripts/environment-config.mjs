/** Shared setup target. An explicitly empty override must not select another database. */
export function resolveOwnerDatabaseUrl(environment) {
  const value = environment.MIGRATION_DATABASE_URL ?? environment.DATABASE_URL;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Set MIGRATION_DATABASE_URL (or DATABASE_URL) to the isolated owner target before running database setup.");
  }
  return value;
}

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isLoopback(hostname) {
  const host = hostname.replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function parseOrigin(value, mode) {
  if (!/^https?:\/\//i.test(value) || /[\s\\?#]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/") return null;
    if (mode === "preview" && (url.protocol !== "https:" || isLoopback(url.hostname))) return null;
    if (url.protocol === "http:" && !isLoopback(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username ||
        url.pathname.length <= 1 || url.hash || value !== value.trim()) return null;
    return url;
  } catch {
    return null;
  }
}

/** Configuration-only check: does not read files, connect to services or return values. */
export function checkEnvironment(environment, mode) {
  if (mode !== "local" && mode !== "preview") throw new Error("Choose local or preview configuration checking.");
  const errors = [];
  const notes = [];
  const addError = (code, message) => errors.push({ code, message });
  const origins = {};

  for (const key of ["NEXT_PUBLIC_APP_URL", "AUTH_URL"]) {
    if (!isPresent(environment[key])) {
      addError(`${key}_MISSING`, `${key} is required; configure the canonical browser origin.`);
      continue;
    }
    const origin = parseOrigin(environment[key], mode);
    if (!origin) {
      addError(`${key}_INVALID`, `${key} must be an origin without credentials, paths, queries or fragments. Preview requires HTTPS and a non-loopback host; HTTP is allowed only for local loopback hosts.`);
      continue;
    }
    origins[key] = origin;
  }
  if (origins.AUTH_URL && origins.NEXT_PUBLIC_APP_URL && origins.AUTH_URL !== origins.NEXT_PUBLIC_APP_URL) {
    addError("ORIGIN_MISMATCH", "AUTH_URL and NEXT_PUBLIC_APP_URL must identify the same browser origin.");
  }
  if (isPresent(environment.NEXTAUTH_URL)) {
    const legacyOrigin = parseOrigin(environment.NEXTAUTH_URL, mode);
    if (!legacyOrigin || (origins.AUTH_URL && legacyOrigin !== origins.AUTH_URL)) {
      addError("NEXTAUTH_URL_CONFLICT", "Remove NEXTAUTH_URL or configure it to match the canonical AUTH_URL origin.");
    }
  }

  if (!isPresent(environment.AUTH_SECRET)) {
    addError("AUTH_SECRET_MISSING", "AUTH_SECRET is required for Auth.js sessions.");
  } else if (Buffer.byteLength(environment.AUTH_SECRET, "utf8") < 32) {
    addError("AUTH_SECRET_SHORT", "AUTH_SECRET is too short; generate an independent secret from at least 32 random bytes.");
  }

  const runtime = isPresent(environment.DATABASE_RUNTIME_URL) ? parseDatabaseUrl(environment.DATABASE_RUNTIME_URL) : null;
  if (!isPresent(environment.DATABASE_RUNTIME_URL)) {
    addError("DATABASE_RUNTIME_URL_MISSING", "DATABASE_RUNTIME_URL is required; the app does not use the migration owner connection as a fallback.");
  } else if (!runtime) {
    addError("DATABASE_RUNTIME_URL_INVALID", "DATABASE_RUNTIME_URL must be a PostgreSQL connection URL containing a host, login and database name.");
  }
  const ownerValue = environment.MIGRATION_DATABASE_URL ?? environment.DATABASE_URL;
  const owner = isPresent(ownerValue) ? parseDatabaseUrl(ownerValue) : null;
  if (runtime && owner && runtime.hostname === owner.hostname && runtime.port === owner.port &&
      runtime.pathname === owner.pathname && runtime.username === owner.username) {
    addError("DATABASE_RUNTIME_OWNER_LOGIN", "DATABASE_RUNTIME_URL must use a separate restricted login from the configured migration owner target.");
  }
  if (mode === "preview" && (isPresent(environment.MIGRATION_DATABASE_URL) || isPresent(environment.DATABASE_URL))) {
    notes.push("Owner credentials are setup-only; omit MIGRATION_DATABASE_URL and DATABASE_URL from the deployed web runtime.");
  }

  for (const key of ["AUTH_SECRET", "DATABASE_RUNTIME_URL", "DATABASE_URL", "MIGRATION_DATABASE_URL", "SMTP_URL",
    "DATABASE_WORKER_URL", "OUTBOX_WORKER_SECRET", "EXPORT_WORKER_SECRET", "ATTACHMENT_SCAN_WORKER_SECRET", "INVITATION_DELIVERY_KEY"]) {
    if (isPresent(environment[`NEXT_PUBLIC_${key}`])) {
      addError("PUBLIC_SECRET", `NEXT_PUBLIC_${key} must not be configured; this value belongs only on the server.`);
    }
  }

  const hasSmtpUrl = isPresent(environment.SMTP_URL);
  const hasSmtpFrom = isPresent(environment.SMTP_FROM);
  if (hasSmtpUrl && hasSmtpFrom) {
    notes.push("SMTP_URL and SMTP_FROM are present. Email delivery has not been tested.");
  } else if (hasSmtpUrl || hasSmtpFrom) {
    notes.push("Email setup is incomplete: SMTP_URL and SMTP_FROM are needed together for email delivery. This does not block a preverified demo sign-in.");
  } else if (mode === "preview") {
    notes.push("Email is optional for preverified demo sign-in. Configure sandbox SMTP_URL and SMTP_FROM before signup or password-recovery tests; Preview has no local mail-file fallback.");
  } else {
    notes.push("Without SMTP, local NODE_ENV=development writes private mail previews. The preverified demo does not require email delivery.");
  }
  if (environment.AUTH_REQUIRE_EMAIL_VERIFICATION?.trim().toLowerCase() === "false") {
    notes.push("Email verification is disabled. Demo provisioning verifies its identity, so demo testing does not require this bypass.");
  }
  notes.push("Workers, invitation delivery and attachment services are optional for this demo auth check and have not been validated. See docs/environment-readiness.md before testing them.");
  notes.push("No service was contacted. Database identity, permissions, migrations, demo provisioning, browser redirects and cookie behavior still need runtime verification.");

  return { errors, notes };
}

export function formatEnvironmentCheck(result) {
  return [
    result.errors.length ? "Environment configuration check failed." : "Environment configuration check passed.",
    ...result.errors.map(({ message }) => `ERROR: ${message}`),
    ...result.notes.map((message) => `NOTE: ${message}`),
    "No configuration values are printed."
  ].join("\n") + "\n";
}
