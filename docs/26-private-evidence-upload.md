# US-068 — private evidence upload slice

This supplement adds draft evidence intake on top of the private, permission-checked download boundary shipped with US-011. It does not change the original v1.0 accounting policy or reference schema.

## Data and API

Migration `20261002130000_private_attachment_uploads.sql` adds the operational `finance.attachment_upload_intents` table. The row is organization-scoped, points to one same-company draft source, belongs to the live uploader, and expires after ten minutes. The object key is generated from the company and intent UUID; callers cannot supply a storage path. Files are limited to PDF, JPEG and PNG, at no more than 10 MiB.

- `POST /api/v1/organizations/{organizationId}/attachments/upload-intents` validates source and metadata and returns an intent.
- `POST /api/v1/organizations/{organizationId}/attachments/{intentId}/complete` accepts a raw byte stream, enforces the intent's maximum size while reading, checks its declared type against a file signature, hashes the exact bytes, uploads with the user's JWT and finalizes the attachment and source link atomically.
- `GET /o/{organizationId}/documents` shows evidence only for source documents the current member may read. Search covers filename, source and uploader; date filtering uses the upload date. Only clean evidence offers a download action.
- Existing `GET /api/v1/organizations/{organizationId}/attachments/{attachmentId}/download` rechecks the current membership and source scope for each byte request. It returns bytes directly; it issues no public or signed URL.

The storage upload policy accepts only a generated key attached to a live pending intent whose uploader still has `attachments.write` and write access to its draft source. The intent's 10-minute lifetime, 10 MiB private bucket limit, no-upsert upload and same-company composite keys bound the object operation. Completion rows and attachment links are committed together. A failed completion attempts to remove the still-pending object with the user's JWT.

## Quarantine and open review gate

New uploads are recorded with `scan_status='pending'`. Pending and rejected files cannot be downloaded. Actual bytes are checked for a PDF/JPEG/PNG signature before storage, but that check is not malware scanning and does not certify file safety.

No approved malware-scanning provider or worker credential contract exists in the source specification. No provider was invented here. Consequently this slice deliberately has no transition from pending to clean/rejected: evidence remains quarantined until the owner approves a scanner and the dedicated organization-scoped worker is implemented and verified. Do not enable this upload flow for production evidence before that gate. Scanner verdicts must be bound to the stored object digest and intent organization; direct browser writes to `scan_status` remain unavailable.

Spreadsheet uploads are not accepted. Formula escaping is required in structured exports and belongs to the relevant export story, not file intake. Filenames are never used in object paths or response headers.

## Validation status

The UI/API/SQL implementation is in branch `feat/us-068-private-evidence`. Tests were deferred at the user's direction while implementation proceeds. The migration has not been applied to a hosted or production database. Real storage, malware-provider, worker-isolation, upgrade, role-boundary and browser checks remain outstanding; this supplement does not claim US-068 is complete.
