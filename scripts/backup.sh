#!/bin/sh
# Database + uploaded files (logo, equipment photos, signed contracts).
set -eu
stamp=$(date +%Y%m%d-%H%M%S)
pg_dump -Fc > "/backups/db-$stamp.dump"
tar -czf "/backups/storage-$stamp.tar.gz" -C /data .
find /backups -type f -mtime +"${KEEP_DAYS:-14}" -delete
echo "backup $stamp complete"
