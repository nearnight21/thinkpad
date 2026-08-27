# ThinkPad 仓库工作约束

本仓库只承载 ThinkPad Web、Server、迁移资料和 ThinkPad 专属部署配置。它已经脱离旧
Monorepo；不要引用其他产品仓库的源码、依赖或本地路径。

## 开始工作前

- 先阅读仓库根目录 `DEVELOPMENT.md` 和 `docs/ENVIRONMENT-SECRETS.md`。
- 在修改文件前按 `DEVELOPMENT.md` 记录的当前分支运行 `scripts/sync-canonical-worktree.ps1`，
  确认工作区干净且与 `origin` 同步。
- 默认只修改本仓库；不要执行历史过滤、重写历史或在归档仓上开发。

## 产品边界

- ThinkPad 使用明文笔记、HttpOnly Cookie 会话和独立 `thinkpad` PostgreSQL schema。
- 不得接入 Memorae 密文协议、Memorae 数据库或 Camp Memories Supabase 表。
- COS 对象必须使用 `thinkpad/<user-id>/...` 前缀；不得修改 Bucket 级 ACL、生命周期或删除策略。
- 路径、部署和文档调整必须保持现有 URL、数据库、Cookie、COS 前缀和业务行为。

## 完成标准

- 在 `server/` 执行 `npm run verify`。
- 涉及 Web 内联页面时，Server 的历史/安全回归测试必须通过。
- 运行 `git diff --check`，并在 CI 与边界脚本落地后运行仓库根目录的边界检查。
- 环境变量只从本地忽略文件、部署机密钥管理或 CI Secret 注入，绝不提交真实值。
