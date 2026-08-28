# ThinkPad 生产静态发布

本文件只描述当前独立 ThinkPad 仓库的发布契约。不得从其他项目目录、旧 Monorepo、归档仓或
历史 worktree 查找或继承部署信息。

## 配置来源

1. 将 `server/deploy/deploy-target.env.example` 复制为同目录的
   `deploy-target.env.local`。
2. 真实 SSH 主机、账号、本机密钥路径和线上目录只写入该本地忽略文件。
3. 运行时 Secret 继续由 `server/deploy/.env` 或部署机密钥管理提供，不得写入部署目标文件。
4. 当前仓库缺少字段时停止部署并询问用户，不从其他项目补齐。

## 静态页面映射

- 本地入口：`web/app.html`。
- 线上入口：`THINKPAD_DEPLOY_WEB_ENTRY`。
- Vendor 资源只有发生实际变更时才同步到 `THINKPAD_DEPLOY_WEB_ROOT/vendor/`。

只修改 Web 静态文件时，不重建 API、不执行数据库迁移、不重启容器，也不重载 Caddy。发布前后
应分别核对目标文件、公开页面和 ThinkPad 本机健康检查；任何覆盖操作都必须使用
`deploy-target.env.local` 中解析出的精确绝对路径。
