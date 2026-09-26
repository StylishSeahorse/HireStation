#!/bin/sh
# Database + uploaded files (logo, equipment photos, signed contracts), plus the bundled
# Docuseal database and data volume when docker-compose.docuseal.yml is in use.
set -eu
stamp=$(date +%Y%m%d-%H%M%S)
pg_dump -Fc > "/backups/db-$stamp.dump"
tar -czf "/backups/storage-$stamp.tar.gz" -C /data .
if [ -n "${DOCUSEAL_PGHOST:-}" ]; then
  PGHOST="$DOCUSEAL_PGHOST" PGUSER=docuseal PGPASSWORD="$DOCUSEAL_PGPASSWORD" PGDATABASE=docuseal \
    pg_dump -Fc > "/backups/docuseal-db-$stamp.dump"
  tar -czf "/backups/docuseal-data-$stamp.tar.gz" -C /docuseal-data .
fi
find /backups -type f -mtime +"${KEEP_DAYS:-14}" -delete
echo "backup $stamp complete"
