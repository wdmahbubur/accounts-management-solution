# Recorded Neon migration history

`migration-history-overrides.json` contains the exact checksums already stored for a subset of migrations on the configured Neon database. Some entries reflect Windows line endings; five entries do not match any committed migration version. The previous source text for those five entries is unavailable.

The migration runner accepts an override only when that migration already has a row with the exact recorded checksum. It skips that migration without executing SQL or changing its stored checksum. A missing migration still runs from the current source, and an unrecognized checksum still stops the migration run. New checkouts hash SQL with LF line endings for cross-platform consistency.

This preserves the live database's recorded history and lets new additive migrations proceed. It does not certify that the unavailable historical SQL matched the current source. Keep these entries scoped to the existing database lineage; do not treat them as a template for a new database.
