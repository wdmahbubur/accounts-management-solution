type DemoEnvironment = Pick<NodeJS.ProcessEnv, "DEMO_ACCOUNT_EMAIL" | "DEMO_ACCOUNT_PASSWORD" | "DEMO_LOGIN_ENABLED">;

export type DemoAccountCredentials = { email: string; password: string };

export function getDemoAccountCredentials(
  environment: DemoEnvironment = process.env
): DemoAccountCredentials | null {
  if (environment.DEMO_LOGIN_ENABLED?.trim().toLowerCase() !== "true") return null;

  const email = environment.DEMO_ACCOUNT_EMAIL?.trim().toLowerCase() ?? "";
  const password = environment.DEMO_ACCOUNT_PASSWORD ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length > 1024) {
    return null;
  }

  return { email, password };
}
