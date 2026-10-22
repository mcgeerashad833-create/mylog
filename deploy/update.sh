#!/usr/bin/env bash
# 更新到 main 分支最新版本并重启（数据库数据不受影响）
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only origin main
docker compose up -d --build
docker image prune -f
docker compose ps
