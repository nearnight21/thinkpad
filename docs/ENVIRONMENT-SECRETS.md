# ThinkPad Environment / Secrets Inventory

> 盘点日期：2026-08-27
>
> 范围：本仓当前 `main` 的 Web、Server、Compose 与一次性迁移工具。
>
> 本文件只记录变量名、来源和用途，不记录真实值。

## 结论

- Web 使用相对 `/thinkpad` API 路径，当前没有客户端环境变量。
- Server 的正式运行时契约应只使用 `THINKPAD_*` 与 `DEEPSEEK_*`。
- 本地、CI、生产都还没有正式的自动注入实现；仓库内也没有 GitHub Actions workflow。
- Server、Compose、Caddy 和迁移工具现在只从 ThinkPad 仓库或当前进程的显式变量读取配置；
  不存在跨产品 env 回退或仓库外默认路径。

脱敏模板见 [`server/.env.example`](../server/.env.example)。Server 不会自动读取 `.env`；模板只定义变量契约，运行时必须由当前 PowerShell 进程、CI Secret 或生产密钥管理显式注入。

## Server 运行时契约

| 变量 | 必需性 / 默认值 | 敏感级别 | Local 来源 | CI 来源 | Production 来源 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| `THINKPAD_HOST` | 可选，`127.0.0.1` | 配置 | PowerShell 进程环境 | 测试 job env | 服务环境 | API 监听地址。 |
| `THINKPAD_PORT` | 可选，`8790` | 配置 | PowerShell 进程环境 | 测试 job env | 服务环境 | API 监听端口。 |
| `THINKPAD_DATABASE_URL` | 必需 | Secret | 仓库外本地开发数据库凭据 | 临时 PostgreSQL service Secret | 生产密钥管理 | ThinkPad PostgreSQL 连接串。 |
| `THINKPAD_SITE_ORIGIN` | 必需 | 配置 | 本地 Web origin | 测试 job env | ThinkPad 部署环境变量 | Cookie 与来源校验。 |
| `THINKPAD_BASE_PATH` | 可选，`/thinkpad` | 配置 | 进程环境或默认值 | 测试 job env | 部署环境变量 | API 与媒体公共前缀。 |
| `THINKPAD_SESSION_DAYS` | 可选，`30` | 配置 | 进程环境或默认值 | 测试 job env | 部署环境变量 | 会话有效天数。 |
| `THINKPAD_COS_BUCKET` | 必需 | 敏感配置 | 仓库外本地环境 | Secret/Environment | 生产密钥管理 | ThinkPad 私有对象桶名称。 |
| `THINKPAD_COS_REGION` | 必需 | 配置 | 仓库外本地环境 | job env | 部署环境变量 | COS 区域。 |
| `THINKPAD_COS_SECRET_ID` | 必需 | Secret | 仓库外本地环境 | GitHub Secret | 生产密钥管理 | COS 最小权限访问身份。 |
| `THINKPAD_COS_SECRET_KEY` | 必需 | Secret | 仓库外本地环境 | GitHub Secret | 生产密钥管理 | COS 最小权限访问密钥。 |
| `DEEPSEEK_API_KEY` | AI 功能必需；其余功能可不设 | Secret | 仓库外本地环境 | 仅需要真实 API 验收时注入 | 生产密钥管理 | AI 解释代理认证。 |
| `DEEPSEEK_MODEL` | 可选，`deepseek-chat` | 配置 | 进程环境或默认值 | job env | 部署环境变量 | AI 模型名称。 |
| `THINKPAD_SITE_DOMAIN` | Caddy 必需 | 配置 | Caddy 启动进程环境 | 部署环境变量 | ThinkPad Caddy 环境变量 | Caddy 站点域名；不设默认值。 |

`THINKPAD_DATABASE_URL` 与四项 COS 变量当前在 Server 启动时必需。任一 Secret 都不得进入 Web、镜像层、Compose 文件、命令行参数、日志或 Git。

## 一次性迁移契约

以下变量只供 `server/src/migrateFromSupabase.ts` 的显式预演或迁移使用，不应进入常规 API、CI 验证或生产常驻环境：

| 变量 | 必需性 | 敏感级别 | 唯一允许来源 | 用途 |
| --- | --- | --- | --- | --- |
| `SUPABASE_DB_URL` | 与 `THINKPAD_SOURCE_DATABASE_URL` 二选一 | Secret | 仓库外、短期、权限受限的迁移环境 | 旧 Supabase 数据库连接串。 |
| `THINKPAD_SOURCE_DATABASE_URL` | 兼容别名 | Secret | 同上 | 源数据库连接串。 |
| `R2_ACCOUNT_ID` | 必需 | 敏感配置 | 同上 | 源 Cloudflare R2 账户。 |
| `R2_ACCESS_KEY_ID` | 必需 | Secret | 同上 | 源 R2 只读访问身份。 |
| `R2_SECRET_ACCESS_KEY` | 必需 | Secret | 同上 | 源 R2 只读访问密钥。 |
| `R2_BUCKET` | 必需 | 敏感配置 | 同上 | 源 R2 桶名称。 |
| `THINKPAD_SOURCE_WORKER_HOST` | 必需 | 配置 | 同上 | 源图片 Worker 主机名；不设默认值。 |

迁移完成后应撤销或删除这组一次性凭据。它们不进入普通 `.env.local`、CI 或生产 Server 环境。
迁移脚本只读取当前进程注入的变量，不读取仓库外文件或 Wrangler 配置。

## 环境来源规则

| 环境 | 允许来源 | 禁止项 | 当前状态 |
| --- | --- | --- | --- |
| Local | 运行命令前显式设置的 PowerShell 环境；真实值保存于仓库外的权限受限文件或密码管理器 | 提交 `.env*` 或从其他产品继承变量 | ThinkPad 模板与 Compose `.env` 契约已建立。 |
| CI | GitHub Actions Variables/Secrets；数据库使用 job 专属临时 service | 普通门禁使用生产数据库、生产 COS 或生产 DeepSeek Secret | 本仓尚无 workflow，也未声明 Secret/Variable 集。 |
| Production | 部署主机密钥管理或仓库外、权限受限的 ThinkPad 专属 env 文件 | 其他产品的 env、数据库、COS 身份或 Worker 配置 | Compose 只读取 ThinkPad `server/deploy/.env`；Caddy 域名显式注入。 |

## 隔离验收状态

以下跨产品配置依赖已在本轮关闭：

1. `server/src/config.ts` 只接受 `THINKPAD_*` 与 `DEEPSEEK_*`。
2. `server/deploy/compose.yaml` 只读取同目录的 ThinkPad `.env`。
3. `THINKPAD_SITE_ORIGIN` 和 Caddy 的 `THINKPAD_SITE_DOMAIN` 都不设跨产品默认值。
4. Caddy 只代理 ThinkPad API 并服务 `/var/www/thinkpad`。
5. `server/src/migrateFromSupabase.ts` 只读取当前进程显式注入的源变量。

Worker/Wrangler/Vercel 与 CI 仍属于后续部署建设范围，但不再作为 ThinkPad Server 的隐式运行时依赖。

隔离完成的验收标准是：fresh clone 只注入 ThinkPad 自己的变量即可启动、测试和部署，且运行时与构建日志中不再出现其他产品的路径或变量前缀。

## 凭据处理规则

- 公开配置也必须按产品隔离；“浏览器可见”不等于可以复用另一个产品的项目或账号。
- Secret 只能放在仓库外本地文件、CI Secret 或生产密钥管理中。
- `.env.example` 只能使用空值或明显无效的示例值。
- 任何密钥轮换只记录变量名、完成时间和责任环境，不记录旧值或新值。
- `server/deploy/install-deepseek-key.sh` 会移动和删除文件，只有在明确的部署任务中、核对三个绝对路径后才能运行。
