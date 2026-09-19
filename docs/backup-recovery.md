# Backup and recovery

Status: local implementation, not deployed. R2 bucket and credentials have been reported configured by the user; live connectivity has not been verified.

## Database-only scheduled backups

`npm run backup:db` creates a SQLite `VACUUM INTO` snapshot including committed WAL data, checks integrity, then publishes the file by rename. The original database is unchanged. A failed snapshot is never published as a completed `.db`. Retention is applied only after success (14 days by default, `BACKUP_RETENTION_DAYS=0` disables pruning). The scheduler awaits completion and skips overlapping runs.

`DB_PATH` and `BACKUP_DIR` resolve relative to the process working directory, matching the application. Use absolute paths in production. These snapshots do not include uploaded documents and remain on the same disk unless separately copied.

## Database + documents bundle

Prepare a maintenance window and actually stop application writes, including background jobs and other writers. The `BACKUP_WRITES_PAUSED=true` flag is an operator confirmation; it does not stop the server. Ensure space for a complete additional copy before running. This is a manual recovery tool, not the automatic daily job.

With absolute `DB_PATH` and `UPLOADS_DIR` configured:

```sh
BACKUP_WRITES_PAUSED=true node server/recovery-bundle.js create /secure/backup-output
node server/recovery-bundle.js verify /secure/backup-output/recovery-ID
node server/recovery-bundle.js restore /secure/backup-output/recovery-ID /secure/new-restore-directory
```

The bundle contains `portflow.db`, a copy of the uploads directory, and a SHA-256 manifest. Verification checks the complete file list, hashes, symlink exclusion, and SQLite integrity. Restore refuses any existing destination. Failed creations remain under `.recovery-*`, never as a completed bundle; inspect/remove only those incomplete directories after diagnosing the failure. Full bundles have no automatic retention yet.

Restoration here is a staging operation, not an automatic production cutover. Inspect restored records and open representative POD/EIR/invoice files before switching the application. Existing absolute file paths in the database are not rewritten: restore into the original layout or perform an explicit, tested path migration. Pre-existing missing documents or externally hosted URLs are not repaired or downloaded by this tool. There is no guarantee of a consistent database/document pair if writes were not actually paused.

## External storage and secrets

Implemented locally: AES-256-GCM per-file encryption, R2 upload with readback authentication, an encrypted index, and download/verification to a new directory. Pending: live connectivity, external scheduling, retention/immutability, and monitoring of failed/missed backups. Do not upload plaintext bundles until this configuration is complete. SHA-256 detects accidental corruption; it is not encryption or authentication against an attacker who can replace the manifest.

Keep the production `ENCRYPTION_KEY` separately in a trusted password manager/recovery vault. It is required to decrypt credentials already stored in SQLite. Keep other infrastructure secrets and recovery instructions separately; do not include `.env` files in the bundle or paste keys into chat. Test recovery in an isolated environment with emails and Port Houston jobs disabled. Do not point a test server at restored production data with real outbound integrations enabled.

Cloudflare R2 Standard is the selected destination. No live upload or external schedule has been activated by these changes. Upload traffic can count toward Render bandwidth even when R2 download egress is free.


## R2 connection (not automatic)

Configure `BACKUP_R2_BUCKET`, `BACKUP_R2_ENDPOINT` (account S3 endpoint, without bucket suffix), `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, and `BACKUP_ENCRYPTION_KEY` (32 random bytes encoded as 64 hex characters). The backup key is independent of `ENCRYPTION_KEY` and must be retained separately for recovery. Keep old backup keys if rotating. An account credential with Object Read & Write limited to the backup bucket is sufficient; bucket administration is not required.

```sh
node server/r2-backups.js upload /secure/verified-bundle
node server/r2-backups.js download recovery/UUID/index.enc /secure/new-restored-directory
```

Each run uses a unique prefix, uploads encrypted files, authenticates readback, and publishes an encrypted index last. Download authenticates into temporary storage, validates paths, verifies the database/document manifest, then creates a new destination. No overwrite, deletion, public URL, or automatic production cutover is performed. Failed uploads may leave incomplete prefixes; remote cleanup and lifecycle rules are not yet automated. The local plaintext source bundle remains protected by filesystem permissions and is not deleted by upload. Hash manifests are wrapped in authenticated encryption in R2.

The scheduled backup remains database-only and local. Do not claim offsite automation until a synthetic live R2 round trip, a controlled full recovery drill, scheduling, retention, and alerts have been configured. Save-only Render variables become available only after a deployment. No production data should be sent for the first connection test.


After deployment and saving all five variables, run `node server/r2-backup-probe.js` from the project root (or `node r2-backup-probe.js` from the server directory). It creates only temporary synthetic data, performs encrypted upload/readback/download/restore, and prints a sanitized result. It never opens the production database or uploads directory. The encrypted synthetic prefix is left in R2 for inspection; it contains no customer data. No production backups or offsite schedule are enabled by this command.
