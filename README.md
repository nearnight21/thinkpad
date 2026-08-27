# ThinkPad

这是 ThinkPad 的独立仓库：

- `web/`：静态 Web 客户端与其 vendor 资源。
- `server/`：Node.js 服务端、测试与部署配置。
- `legacy/`：只用于追溯或迁移的旧 Supabase schema。
- `docs/`：开发交接和环境变量清单。
- `scripts/`：仓库同步和后续仓库级检查脚本。

规范分支为 `main`，远端为 `https://github.com/nearnight21/thinkpad`。新的 Vercel、Worker
和 Wrangler 配置将在 Phase 5 的部署阶段单独重建。

服务端验证：

```powershell
cd server
npm run verify
```

跨电脑交接前运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-canonical-worktree.ps1
```
