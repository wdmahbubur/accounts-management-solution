import "server-only";

export type ScanProviderCode = "SCAN_PROVIDER_UNAVAILABLE" | "SCAN_QUOTA_EXCEEDED" | "SCAN_PROTOCOL_ERROR" |
  "SCAN_RESULT_MISMATCH" | "SCAN_SUBMISSION_UNCONFIRMED" | "SCAN_PENDING" | "SCAN_TIMEOUT" | "OBJECT_READ_ERROR" | "OBJECT_DIGEST_MISMATCH";
export class ScanProviderError extends Error {
  readonly code: ScanProviderCode;
  readonly httpStatus?: number;
  constructor(code: ScanProviderCode, httpStatus?: number) { super(code); this.code = code; this.httpStatus = httpStatus; }
}
export interface ScanReference { created: boolean; remoteId: string | null; createdAt: string }
export interface ScanCheckpoint {
  begin(): Promise<ScanReference>;
  attach(remoteId: string): Promise<boolean>;
  abandonUnsubmitted(): Promise<boolean>;
}
export interface ScanInput { byteSize: number; sha256: string; readBytes(): Promise<Uint8Array> }
export interface ScanDecision { decision: "clean" | "rejected"; engine: string }
export interface AttachmentScanProvider {
  check(): Promise<void>;
  scan(input: ScanInput, checkpoint: ScanCheckpoint): Promise<ScanDecision>;
}
