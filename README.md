# MyLog

把每天的琐事排成一条清单，一条一条做完。

- 功能设计：[docs/01-功能设计.md](docs/01-功能设计.md)
- 界面原型：[design/prototype](design/prototype)

前端：React + TypeScript + Vite，数据存在浏览器 IndexedDB，离线可用。服务端：Node.js（Fastify）+ MySQL，负责邮箱登录和多设备同步。

## 开发

需要 Node.js 22.18+ 和 MySQL 8。

```bash
npm install

# 建库（只需一次），表会在服务端启动时自动创建
mysql -uroot -e "CREATE DATABASE mylog CHARACTER SET utf8mb4;
  CREATE USER 'mylog'@'localhost' IDENTIFIED BY 'mylog_dev';
  GRANT ALL ON mylog.* TO 'mylog'@'localhost';"

npm run dev:server   # 服务端 http://127.0.0.1:8787
npm run dev          # 前端 http://localhost:5173，/api 自动转发到服务端
npm test             # 单元测试 + 服务端接口测试（接口测试用 mylog_test 库，连不上会跳过）
```

## 部署

用 Docker Compose 一键运行 MyLog + MySQL，前面用 Nginx 提供 HTTPS，详见 [docs/02-部署.md](docs/02-部署.md)。上线时对照 [docs/03-上线检查清单.md](docs/03-上线检查清单.md) 逐项检查。

```bash
cp .env.example .env        # 填两个数据库密码
docker compose up -d --build
```

## 同步是怎么做的

- 每条任务、每天的记录都带 `updatedAt`，删除是软删除（`deletedAt`）。
- 本地每次修改会记进「待推送」表；同步时把这些推上去，再按游标拉回其他设备的改动。
- 同一条记录两边都改了，以 `updatedAt` 更晚的为准（后写者胜）。
- 断网时照常使用，恢复联网、回到窗口或每 30 秒自动同步。

## 进度

- [x] 快速添加（中文日期 / 时间 / `!` 重要 / `#标签` 识别），`Ctrl/⌘ + K` 唤起
- [x] 今天：进度条、一键完成与撤销、拖拽排序、已完成折叠
- [x] 之前遗留：全部移到今天 / 逐条处理
- [x] 收集箱、以后（按日期分组）
- [x] 任务详情：标题、重要、日期、时间、标签、子步骤、备注、删除（可撤销）
- [x] 账户与多设备同步（邮箱 + 密码登录，MySQL）
- [x] 早间规划（每天首次打开自动弹出，键盘 1/2/3 快速决定）
- [x] 日志：每天的完成记录、最近 7 天、晚间收尾与一句话总结
- [x] 重复任务（每天 / 工作日 / 每周几 / 每月几号，完成后自动生成下一次）
- [x] 到点提醒（系统通知，可提前 5–60 分钟，默认安静不响铃）
- [x] 搜索（标题、备注、子步骤、每天的一句话；`#标签` 只搜标签；快捷键 `/`）
