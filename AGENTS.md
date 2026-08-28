# ThinkPad 仓库工作约束

本仓库只承载 ThinkPad Web、Server、迁移资料和 ThinkPad 专属部署配置。它已经脱离旧
Monorepo；不要引用其他产品仓库的源码、依赖或本地路径。

## 开始工作前

- 先阅读仓库根目录 `DEVELOPMENT.md` 和 `docs/ENVIRONMENT-SECRETS.md`。
- 在修改文件前按 `DEVELOPMENT.md` 记录的当前分支运行 `scripts/sync-canonical-worktree.ps1`，
  确认工作区干净且与 `origin` 同步。
- 默认只修改本仓库；不要执行历史过滤、重写历史或在归档仓上开发。

## 仓库读取边界

- 默认只允许读取和搜索当前 ThinkPad 仓库。未经用户明确同意，不得读取、搜索、列举或引用
  其他项目目录、旧 Monorepo、归档仓、历史 worktree 或其配置文件。
- 当前仓库缺少所需信息时必须停止并向用户说明缺项；不得从兄弟项目、旧项目或其他产品的
  源码、文档、环境文件、部署资料或本地路径中补齐。
- 本机生产部署目标只从忽略文件 `server/deploy/deploy-target.env.local` 获取。未经用户明确
  同意，不得转而检查全局 SSH 配置、Shell 历史或仓库外的部署配置。
- 用户明确同意临时读取仓库外信息时，只读取获准的具体路径和任务必需字段，不把其他项目的
  内容、结构、依赖或配置复制进本仓库。

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
