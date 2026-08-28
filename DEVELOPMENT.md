# ThinkPad 开发交接

> 最后更新：2026-08-27
>
> 当前阶段：Phase 5「新仓可开发化」。本文件只记录独立 ThinkPad 仓库的开发状态，
> 不再承载旧 Monorepo 的历史审计或产品路线。

## 当前状态

- 规范分支：`main`；`origin` 为 `https://github.com/nearnight21/thinkpad.git`。
- 源码与 Git 历史拆分已完成，独立仓已推送到新的 GitHub 远端。
- 本阶段已建立仓库治理文件、环境变量清单、根忽略规则和同步脚本。
- 独立 CI 和边界检查尚未创建；生产部署配置已改为只接受 ThinkPad 自己的环境来源。
- `server/deploy/compose.yaml` 从同目录未跟踪的 `.env` 读取 ThinkPad 运行时变量，Caddy
  通过 `THINKPAD_SITE_DOMAIN` 显式选择站点域名。
- 本机生产 SSH 目标与静态发布路径统一保存在忽略文件
  `server/deploy/deploy-target.env.local`；字段契约见同目录脱敏模板，后续部署不得再从旧仓或
  其他项目目录查找配置。

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

迁移脚本默认只读；需要迁移时必须明确使用 `-- --apply`，并在当前进程中注入一次性、
权限受限的源环境变量。脚本不会读取仓库外的 `.env` 或 Wrangler 配置。
常规开发不得连接源 Supabase 或写入生产 COS。

## 跨电脑同步

工作区干净时运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-canonical-worktree.ps1
```

脚本只允许 `main` 快进到 `origin/main`；本地领先或分叉时停止，
不执行 stash、reset、rebase、cherry-pick 或 push。

## 环境与交接规则

环境变量清单见 [`docs/ENVIRONMENT-SECRETS.md`](docs/ENVIRONMENT-SECRETS.md)。真实值只能来自
本机忽略文件、部署机密钥管理或 CI Secret；交接时只记录变量是否已配置和验证结果，不记录值。
ThinkPad 的独立 Worker/Wrangler、Vercel 路由和 CI 仍待后续部署阶段重建；当前 Server Compose
与 Caddy 配置已不依赖其他产品仓库。
