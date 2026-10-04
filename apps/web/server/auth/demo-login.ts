/** Public credentials for the isolated, synthetic demo company. */
export const DEMO_ACCOUNT_EMAIL = "demo@ams-public-demo.example";
export const DEMO_ACCOUNT_PASSWORD = "Demo@AMS2026!";

export type DemoAccountCredentials = { email: string; password: string };

export function getDemoAccountCredentials(): DemoAccountCredentials {
  return { email: DEMO_ACCOUNT_EMAIL, password: DEMO_ACCOUNT_PASSWORD };
}

export function isDemoAccountEmail(email: string): boolean {
  return email.trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
}
