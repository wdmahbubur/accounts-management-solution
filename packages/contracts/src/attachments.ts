export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Keep browser multipart uploads below the web host's request-body ceiling.
export const MAX_BROWSER_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const attachmentMimeExtensions: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": ["pdf"], "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"],
  "image/webp": ["webp"], "text/plain": ["txt"], "text/csv": ["csv"]
};
