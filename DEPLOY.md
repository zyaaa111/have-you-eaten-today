# 本地部署指南

## 架构

```
朋友的手机/电脑 ─┐
你的手机/电脑 ──┼──> 内网穿透域名 ──> Next.js Node 服务
朋友的平板 ─────┘                         │
                                         ├─> app/* 页面
                                         ├─> app/api/* Route Handlers
                                         └─> SQLite（server/data/menu.db）
```

当前项目不是前后端分离，也没有单独的 Express 服务。页面和 API 都由 `next start` 启动的同一个 Next.js 进程提供。

## 1. 环境要求

- Node.js 18+
- Windows / Linux / macOS

## 2. 安装与启动

```bash
# 克隆项目
cd D:\path\to\Have_you_eaten_today

# 安装依赖
npm install

# 生产构建
npm run build

# 启动服务（默认端口 3000）
npm run start
```

启动后访问 `http://localhost:3000`。

## 3. 开发模式

```bash
npm run dev
```

开发模式同样由 Next.js 统一提供页面和 `app/api/*` 接口。

## 4. API 地址配置

- 同域部署时，不需要配置 `NEXT_PUBLIC_API_BASE_URL`，浏览器默认请求 `/api`
- 如果你要把前端请求转发到独立 API 域名，必须在构建前设置：

```bash
NEXT_PUBLIC_API_BASE_URL=https://example.com/api
```

- `NEXT_PUBLIC_*` 变量会在构建时写入浏览器代码；修改后必须重新执行 `npm run build`，只重启 `npm run start` 不会生效
- `.env.local` 只适合本机环境，不会被 Git 提交，也不应被当成生产配置来源

## 5. 内网穿透配置

推荐使用以下工具之一：

### cpolar
1. 下载安装 cpolar：https://www.cpolar.com/
2. 注册账号并获取 authtoken
3. 运行：`cpolar http 3000`
4. 复制生成的公网地址分享给朋友

### frp
- 需要一台有公网 IP 的服务器作为 frps
- 在本地电脑运行 frpc，配置 `local_port = 3000`

### 花生壳
- 注册花生壳账号
- 添加映射，内网主机填写本机 IP，端口 `3000`

## 6. 数据备份

核心数据文件：`server/data/menu.db`

备份时建议同时保留：

- `server/data/menu.db`
- `server/data/menu.db-wal`
- `server/data/menu.db-shm`

### Windows 自动备份（任务计划程序）

```batch
xcopy /Y "D:\path\to\Have_you_eaten_today\server\data\menu.db*" "D:\backups\"
```

### Linux / macOS（crontab）

```bash
0 2 * * * cp /path/to/Have_you_eaten_today/server/data/menu.db* /path/to/backups/
```

## 7. 常见问题

**Q: 同步时出现 `/sync/menu-items` 404？**  
A: 这是浏览器请求到了错误路径。请确认当前版本已经重新构建，并确保同域部署下使用默认 `/api`，或在构建前正确设置 `NEXT_PUBLIC_API_BASE_URL`。

**Q: 如何更换部署电脑？**  
A: 复制整个项目目录和 `server/data/menu.db*` 文件到新电脑，重新执行 `npm install` → `npm run build` → `npm run start`。

**Q: 多人同时编辑冲突怎么办？**  
A: 当前仍采用 Last-Write-Wins（最后写入优先）策略，旧版本可在“变更记录”页面找回。
