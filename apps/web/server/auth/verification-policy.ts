/** Email verification stays required unless an operator explicitly disables it. */
export function isEmailVerificationRequired(): boolean {
  return process.env.AUTH_REQUIRE_EMAIL_VERIFICATION?.trim().toLowerCase() !== "false";
}
