# ThinkPad

ThinkPad 的代码和历史资源集中在本目录：

- `web/`：静态 Web 客户端与其 vendor 资源。
- `server/`：Node.js 服务端、测试与部署配置。
- `legacy/`：只用于追溯或迁移的旧 Supabase schema。

仓库根目录的 `worker.js`、`wrangler.toml` 和 `vercel.json` 仍包含 ThinkPad 与 Camp Memories 共用的历史生产部署配置，因此第一期不移动它们。

服务端验证：

```powershell
cd projects/thinkpad/server
npm run verify
```
