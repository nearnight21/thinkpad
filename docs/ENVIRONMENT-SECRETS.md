# Environment / Secrets Inventory

> 盘点日期：2026-08-27
>
> 本文件只记录变量名、来源和用途，不记录任何真实值。真实值只能存在于本机忽略文件、
> 部署机密钥管理或 CI Secret 中。

## Server 运行时

| 变量 | 类型 | 来源 | 用途 |
| --- | --- | --- | --- |
| `THINKPAD_HOST` | 配置 | Server 进程环境 | 监听地址，默认本机回环。 |
| `THINKPAD_PORT` | 配置 | Server 进程环境 | API 监听端口。 |
| `THINKPAD_DATABASE_URL` | Secret | Server 部署环境 | ThinkPad PostgreSQL 连接串。 |
| `THINKPAD_SITE_ORIGIN` | 配置 | Server 部署环境 | Cookie 和站点来源校验。 |
| `THINKPAD_BASE_PATH` | 配置 | Server 部署环境 | API/媒体公共前缀，默认 `/thinkpad`。 |
| `THINKPAD_SESSION_DAYS` | 配置 | Server 部署环境 | 会话有效天数。 |
| `THINKPAD_COS_BUCKET` | 配置 | Server 部署环境 | ThinkPad 私有对象桶名称。 |
| `THINKPAD_COS_REGION` | 配置 | Server 部署环境 | COS 区域。 |
| `THINKPAD_COS_SECRET_ID` | Secret | Server 部署机密钥管理 | COS 访问身份。 |
| `THINKPAD_COS_SECRET_KEY` | Secret | Server 部署机密钥管理 | COS 访问密钥。 |
| `MEMORY_RECALL_DATABASE_URL` | Secret | 旧部署环境 | `THINKPAD_DATABASE_URL` 的兼容回退，拆仓后应逐步移除。 |
| `MEMORY_RECALL_COS_BUCKET` | 配置 | 旧部署环境 | `THINKPAD_COS_BUCKET` 的兼容回退。 |
| `MEMORY_RECALL_COS_REGION` | 配置 | 旧部署环境 | `THINKPAD_COS_REGION` 的兼容回退。 |
| `MEMORY_RECALL_COS_SECRET_ID` | Secret | 旧部署机密钥管理 | `THINKPAD_COS_SECRET_ID` 的兼容回退。 |
| `MEMORY_RECALL_COS_SECRET_KEY` | Secret | 旧部署机密钥管理 | `THINKPAD_COS_SECRET_KEY` 的兼容回退。 |
| `DEEPSEEK_API_KEY` | Secret | Server 部署机密钥管理 | ThinkPad AI 解释代理认证。 |
| `DEEPSEEK_MODEL` | 配置 | Server 进程环境 | AI 请求使用的模型名称。 |
| `MEMORY_RECALL_ENV_FILE` | Secret 路径 | Compose 启动环境 | 旧 Compose 的 env file 路径；当前默认指向 Memorae，Phase 5 必须替换为 ThinkPad 自己的文件。 |

## 迁移专用

以下变量只供 `server/src/migrateFromSupabase.ts` 的迁移预演或显式迁移使用，不应进入
常规 API 运行环境：

| 变量 | 类型 | 来源 | 用途 |
| --- | --- | --- | --- |
| `SUPABASE_DB_URL` | Secret | 一次性迁移环境文件 | 读取旧 Supabase 数据库。 |
| `THINKPAD_SOURCE_DATABASE_URL` | Secret | 一次性迁移环境文件 | `SUPABASE_DB_URL` 的兼容名称。 |
| `R2_ACCOUNT_ID` | 配置 | 一次性迁移环境文件或 Wrangler 配置 | 连接源 Cloudflare R2。 |
| `R2_ACCESS_KEY_ID` | Secret | 一次性迁移环境文件 | 读取源 R2 对象。 |
| `R2_SECRET_ACCESS_KEY` | Secret | 一次性迁移环境文件 | 读取源 R2 对象。 |
| `R2_BUCKET` | 配置 | 一次性迁移环境文件 | 源 R2 桶名称。 |

## 外部部署配置

旧共享 Worker/Wrangler 使用的变量仍在待拆分部署配置中维护：`R2_PUBLIC_URL`、
`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`DEEPSEEK_MODEL` 以及 R2 bucket binding。它们不应
通过本仓库的应用运行时环境隐式继承；Phase 5 部署阶段会建立 ThinkPad 自己的配置和来源。

## 注入规则

- 本地开发：使用未跟踪的 `.env`/`.env.local`，只提交脱敏的 `.env.example`。
- 服务器：使用部署机密钥管理或权限受限的环境文件，禁止把 Secret 写入 Compose、日志或命令行参数。
- CI：只使用 GitHub Actions Environment/Secret；当前阶段尚未创建新的 GitHub 远端和 workflow。
- 迁移完成后删除一次性迁移凭据和临时文件，并在交接文档记录删除结果，不记录凭据内容。
