# ThinkPad 开发交接

> 最后更新：2026-08-27
>
> 当前阶段：Phase 5「新仓可开发化」。本文件只记录独立 ThinkPad 仓库的开发状态，
> 不再承载旧 Monorepo 的历史审计或产品路线。

## 当前状态

- 当前迁移暂存分支：`codex/cos-direct-transfer`；创建新 GitHub 远端时切换并固定 `main` 为规范分支。
- 本地过滤仓已完成源码与 Git 历史拆分；当前 `origin` 仍是迁移验证用的只读本地远端。
- 本阶段已建立仓库治理文件、环境变量清单、根忽略规则和同步脚本。
- 新 GitHub 远端、独立 CI、边界检查和生产部署配置尚未创建，按 Phase 5 后续步骤处理。
- `server/deploy/compose.yaml` 仍通过 `MEMORY_RECALL_ENV_FILE` 默认读取 Memorae 环境文件；这是
  当前独立部署阻塞项，部署阶段必须改为 ThinkPad 自己的环境来源后才能验收。

## 仓库结构

- `web/`：ThinkPad 静态 Web 页面及 vendor 资源。
- `server/`：Node.js API、数据库迁移、测试和容器部署资料。
- `legacy/`：只读追溯用的旧 Supabase schema，不参与当前服务运行。
- `docs/ENVIRONMENT-SECRETS.md`：变量名、来源和用途清单，不含真实值。
- `scripts/`：仓库级同步和后续检查脚本。

## 本地开发与验证

```powershell
npm.cmd ci --prefix server
npm.cmd run verify --prefix server
git diff --check
```

迁移脚本默认只读；需要迁移时必须明确使用 `-- --apply`，并使用一次性、权限受限的环境文件。
常规开发不得连接源 Supabase 或写入生产 COS。

## 跨电脑同步

工作区干净时运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-canonical-worktree.ps1 `
  -CanonicalBranch codex/cos-direct-transfer
```

脚本默认只允许 `main` 快进到 `origin/main`；切换前可显式传入
`-CanonicalBranch codex/cos-direct-transfer` 做迁移暂存分支验证。本地领先或分叉时停止，
不执行 stash、reset、rebase、cherry-pick 或 push。

## 环境与交接规则

环境变量清单见 [`docs/ENVIRONMENT-SECRETS.md`](docs/ENVIRONMENT-SECRETS.md)。真实值只能来自
本机忽略文件、部署机密钥管理或 CI Secret；交接时只记录变量是否已配置和验证结果，不记录值。
ThinkPad 的独立 Worker/Wrangler、Vercel 路由和 Compose 环境路径仍待 Phase 5 部署阶段重建。
