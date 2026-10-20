export type RegistrationState = {
  error?: "invalid_input" | "password_policy" | "email_unavailable";
  status?: "check_email" | "verification_requested";
};

type VerificationServices = {
  emailAvailable: boolean;
  findUnverifiedUser(email: string): Promise<string | null>;
  sendVerification(userId: string, email: string): Promise<void>;
};

type RegistrationServices = Pick<VerificationServices, "emailAvailable" | "sendVerification"> & {
  createUser(email: string, password: string, displayName: string): Promise<string | null>;
};

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function registerAccount(form: FormData, services: RegistrationServices): Promise<RegistrationState> {
  const email = text(form, "email").toLowerCase();
  const password = text(form, "password");
  const displayName = text(form, "display_name").slice(0, 120);
  if (!validEmail(email)) return { error: "invalid_input" };
  if (password.length < 10 || password.length > 1024 || !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) || !/\d/.test(password)) return { error: "password_policy" };
  // A deployment-wide readiness error is safe to show before any account lookup.
  if (!services.emailAvailable) return { error: "email_unavailable" };
  try {
    const userId = await services.createUser(email, password, displayName);
    if (userId) await services.sendVerification(userId, email);
  } catch {
    // Existing accounts and per-account/provider failures have the same public result.
  }
  return { status: "check_email" };
}

export async function requestVerification(form: FormData, services: VerificationServices): Promise<RegistrationState> {
  const email = text(form, "email").toLowerCase();
  if (!validEmail(email)) return { error: "invalid_input" };
  if (!services.emailAvailable) return { error: "email_unavailable" };
  try {
    const userId = await services.findUnverifiedUser(email);
    if (userId) await services.sendVerification(userId, email);
  } catch {
    // Do not reveal whether an account exists or expose SMTP/database diagnostics.
  }
  return { status: "verification_requested" };
}
