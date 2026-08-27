# ThinkPad 国内独立服务

此目录只承载 ThinkPad 的笔记服务与独立部署配置。

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

迁移脚本只读取当前进程中显式注入的一次性变量：

```text
SUPABASE_DB_URL=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
THINKPAD_SOURCE_WORKER_HOST=...
```

脚本直接通过 R2 的 S3 接口读取正文引用的对象。`R2_ACCOUNT_ID` 和源图片 Worker 主机名
必须显式提供，脚本不会从其他仓库、`.env` 文件或 Wrangler 配置读取值。

## 运行环境变量

服务只读取 `THINKPAD_*` 和 `DEEPSEEK_*`。数据库、站点来源和四项 COS 配置都必须显式提供。
DeepSeek 需要单独提供：

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-chat
```

密钥只放服务器的忽略文件或部署密钥管理中，不提交到 Git。

Compose 从 `server/deploy/.env` 读取 ThinkPad 专属环境；该文件不提交到 Git。生产 Caddy
需要在启动进程中显式提供 `THINKPAD_SITE_DOMAIN`，并使用本目录的 ThinkPad 专属站点配置。

`deploy/install-deepseek-key.sh` 用于从临时环境文件中只提取 DeepSeek 密钥，安装前会备份目标环境文件并在完成后删除临时源文件。`deploy/verify-deepseek.mjs` 只执行一个最小请求并输出 HTTP 状态，不输出密钥或回答内容。
