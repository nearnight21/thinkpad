# ThinkPad 产品边界

本目录只承载 ThinkPad Web、Server 及其产品专属部署资料。

## 工作范围

- 默认只修改本目录。
- 根目录 `worker.js` 与 `wrangler.toml` 是 ThinkPad/Camp 共用的历史部署入口；任务明确涉及它们时先读取 `../../docs/REPOSITORY-OWNERSHIP.md`，保持现有生产行为。
- ThinkPad 使用明文笔记、Cookie 会话和独立 `thinkpad` PostgreSQL schema；不得接入 Memorae 密文协议或 Camp Supabase 数据。
- 路径移动只修复 import、测试夹具、构建、部署和文档路径；保持 URL、数据库、Cookie、COS 前缀和业务行为不变。

## 完成标准

- 运行 Server `npm run verify`。
- 涉及旧静态 Web 时，Server 的前端内联脚本回归测试必须通过。
- 运行仓库根目录 `node scripts/check-product-boundaries.mjs`。
