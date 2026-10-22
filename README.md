# MyLog

把每天的琐事排成一条清单，一条一条做完。

- 功能设计：[docs/01-功能设计.md](docs/01-功能设计.md)
- 界面原型：[design/prototype](design/prototype)

## 开发

```bash
npm install
npm run dev        # 本地开发 http://localhost:5173
npm test           # 单元测试
npm run build      # 类型检查 + 打包
```

技术栈：React + TypeScript + Vite；数据存在浏览器 IndexedDB（Dexie），每条记录带 `updatedAt` / `deletedAt`，为多设备同步做准备。

## 进度

- [x] 快速添加（中文日期 / 时间 / `!` 重要 / `#标签` 识别），`Ctrl/⌘ + K` 唤起
- [x] 今天：进度条、一键完成与撤销、拖拽排序、已完成折叠
- [x] 之前遗留：全部移到今天 / 逐条处理
- [x] 收集箱、以后（按日期分组）
- [x] 任务详情：标题、重要、日期、时间、标签、子步骤、备注、删除（可撤销）
- [ ] 账户与多设备同步
- [x] 早间规划（每天首次打开自动弹出，键盘 1/2/3 快速决定）
- [x] 日志：每天的完成记录、最近 7 天、晚间收尾与一句话总结
- [ ] 重复任务、到点提醒、搜索、设置
