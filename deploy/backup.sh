#!/usr/bin/env bash
# 把云数据库导出一份到云服务器上，保留 14 天。云数据库自带的自动备份是主力，这是多一份保险。
# 用 crontab 定时执行，例如：
#   30 3 * * * /opt/mylog/deploy/backup.sh >> /var/log/mylog-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=${BACKUP_DIR:-/var/backups/mylog}
mkdir -p "$DIR"
FILE="$DIR/mylog-$(date +%F).sql.gz"

# 用应用容器里的 Node 解析 .env 里的 DATABASE_URL（密码可能做过 URL 编码）
read -r HOST PORT USER DB < <(docker compose exec -T app node -e '
  const u = new URL(process.env.DATABASE_URL)
  console.log(u.hostname, u.port || 3306, decodeURIComponent(u.username), decodeURIComponent(u.pathname.slice(1)))')
PASS=$(docker compose exec -T app node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).password))')

# 应用配了云厂商的 CA 证书（走公网）时，导出也用 SSL 并校验证书
SSL=(--ssl-mode=PREFERRED)
MOUNT=()
if [ -f deploy/db-ca.pem ] && docker compose exec -T app sh -c 'test -n "$DATABASE_CA_FILE"'; then
  SSL=(--ssl-mode=VERIFY_CA --ssl-ca=/db-ca.pem)
  MOUNT=(-v "$PWD/deploy/db-ca.pem:/db-ca.pem:ro")
fi

# 云数据库的账号一般没有 PROCESS 权限，也开着 GTID，这两个参数避免导出和恢复时报错
docker run --rm --network host "${MOUNT[@]}" -e MYSQL_PWD="$PASS" mysql:8.0 \
  mysqldump -h "$HOST" -P "$PORT" -u "$USER" "${SSL[@]}" \
  --single-transaction --no-tablespaces --set-gtid-purged=OFF "$DB" | gzip > "$FILE"

find "$DIR" -name 'mylog-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') 备份完成：$FILE"
