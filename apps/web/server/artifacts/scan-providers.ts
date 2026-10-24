import "server-only";
import { ClamAvError, readClamAvVersion, scanWithClamAv } from "./clamav.ts";
import { BouncerScanner, bouncerConfiguration } from "./bouncer.ts";
import { ScanProviderError, type AttachmentScanProvider } from "./scan-provider.ts";

export function attachmentScanProvider(): { name: "clamav" | "bouncer"; scanner: AttachmentScanProvider } {
  const name = process.env.ATTACHMENT_SCAN_PROVIDER ?? "clamav";
  if (name === "bouncer") return { name, scanner: new BouncerScanner(bouncerConfiguration(process.env)) };
  if (name !== "clamav") throw new ScanProviderError("SCAN_PROVIDER_UNAVAILABLE");
  return { name, scanner: {
    check: async () => { await readClamAvVersion(); },
    scan: async input => {
      const bytes = await input.readBytes();
      const engine = await readClamAvVersion();
      const decision = await scanWithClamAv(bytes);
      return { decision: decision === "clean" ? "clean" : "rejected", engine };
    }
  } };
}
export function scanFailureCode(error: unknown) {
  return error instanceof ScanProviderError || error instanceof ClamAvError ? error.code : "SCAN_WORKER_ERROR";
}
