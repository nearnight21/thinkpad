# ThinkPad 国内独立服务

此目录只承载 `master` 时代的 ThinkPad 笔记，不包含 Camp Memories。

## 数据边界

- PostgreSQL 全部使用 `thinkpad` schema，不接触现有 Memory Recall 表。
- COS 全部使用 `thinkpad/<user-id>/...` 前缀，不修改 Bucket 级 ACL、生命周期或删除规则。
- 浏览器只保存 `HttpOnly` 会话 Cookie，JavaScript 无法读取令牌。
- 正文图片保存稳定的 `/thinkpad/api/media/...` 地址，由 API 验证登录后跳转到短期 COS 签名地址。

## 本地验证

```powershell
npm install
npm run verify
npm run migrate:source
```

`migrate:source` 默认只读预演。只有显式追加 `-- --apply` 才会写入目标 PostgreSQL 和 COS。

迁移脚本默认读取仓库根目录 `.env`：

```text
SUPABASE_DB_URL=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
```

旧 Worker 域名不可用时，脚本直接通过 R2 的 S3 接口读取正文引用的对象。若
`R2_ACCOUNT_ID` 不是 Cloudflare 的 32 位项目 ID，会从同仓库 `wrangler.toml`
读取公开的 `account_id`；R2 Access Key、Secret 和 Bucket 不使用其他来源。

## 运行环境变量

服务优先读取 `THINKPAD_*`，COS 和数据库变量缺省时复用服务器已有的
`MEMORY_RECALL_DATABASE_URL` 与 `MEMORY_RECALL_COS_*`。DeepSeek 需要单独提供：

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-chat
```

密钥只放服务器的忽略文件中，不提交到 Git。

`deploy/install-deepseek-key.sh` 用于从临时环境文件中只提取 DeepSeek 密钥，安装前会备份目标环境文件并在完成后删除临时源文件。`deploy/verify-deepseek.mjs` 只执行一个最小请求并输出 HTTP 状态，不输出密钥或回答内容。
