import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch (error) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
}
