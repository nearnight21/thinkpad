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

## 运行环境变量

服务优先读取 `THINKPAD_*`，COS 和数据库变量缺省时复用服务器已有的
`MEMORY_RECALL_DATABASE_URL` 与 `MEMORY_RECALL_COS_*`。DeepSeek 需要单独提供：

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-chat
```

密钥只放服务器的忽略文件中，不提交到 Git。
