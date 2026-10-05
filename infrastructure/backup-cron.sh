#!/usr/bin/env bash
# Install: crontab -e  →  */15 * * * * /opt/cricket/infrastructure/backup-cron.sh >> /var/log/cricket/backup.log 2>&1
# Every 15 minutes during the tournament; mongodump is consistent per collection and the event
# log is append-only, so a restore never yields a half-scored ball.
set -euo pipefail
cd "$(dirname "$0")/../server"
node --env-file=.env scripts/backup.js
# Optional off-site copy (configure rclone first):
# rclone copy "${BACKUP_DIR:-/var/backups/cricket}" remote:cricket-backups --max-age 1h
