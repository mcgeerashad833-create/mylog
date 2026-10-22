#!/usr/bin/env bash
# 每天备份一次数据库，保留 14 天。用 crontab 定时执行，例如：
#   30 3 * * * /opt/mylog/deploy/backup.sh >> /var/log/mylog-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=${BACKUP_DIR:-/var/backups/mylog}
mkdir -p "$DIR"
FILE="$DIR/mylog-$(date +%F).sql.gz"
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines mylog' | gzip > "$FILE"
find "$DIR" -name 'mylog-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') 备份完成：$FILE"
