# 本地部署指南

## 架构

```
朋友的手机/电脑 ─┐
你的手机/电脑 ──┼──> 内网穿透域名 ──> 你的空闲电脑
朋友的平板 ─────┘
                        │
                        ├─> Node.js Express 服务（serve 前端 + API）
                        │
                        └─> SQLite 单文件数据库（server/data/menu.db）
```

## 1. 环境要求

- Node.js 18+
- Windows / Linux / macOS

## 2. 安装与启动

```bash
# 克隆项目
cd D:\path\to\Have_you_eaten_today

# 安装依赖
npm install

# 构建前端（生成 dist/ 目录）
npm run build

# 启动本地服务端（端口 3000）
npm run server:start
```

启动后访问 http://localhost:3000

## 3. 开发模式

```bash
# 启动后端 API 服务（端口 3000）
npm run server:dev

# 另一个终端启动前端开发服务器（端口 3001，需要修改 .env.local 为 http://localhost:3000/api）
npm run dev
```

## 4. 内网穿透配置

推荐使用以下工具之一：

### cpolar（最简单，有免费版）
1. 下载安装 cpolar：https://www.cpolar.com/
2. 注册账号并获取 authtoken
3. 运行：`cpolar http 3000`
4. 复制生成的公网地址分享给朋友

### frp（自建，最稳定）
- 需要一台有公网 IP 的服务器作为 frps
- 在本地电脑运行 frpc，配置 local_port = 3000

### 花生壳
- 注册花生壳账号
- 添加映射，内网主机填写本机 IP，端口 3000

## 5. 数据备份

核心数据文件：`server/data/menu.db`

**备份就是复制这个文件。**

### Windows 自动备份（任务计划程序）
创建 `.bat` 文件：
```batch
xcopy /Y "D:\path\to\Have_you_eaten_today\server\data\menu.db" "D:\backups\menu-%date:~0,4%%date:~5,2%%date:~8,2%.db"
```
添加到 Windows 任务计划程序，每天运行一次。

### Linux / macOS（crontab）
```bash
0 2 * * * cp /path/to/server/data/menu.db /path/to/backups/menu-$(date +\%Y\%m\%d).db
```

## 6. 数据迁移保障

即使未来要从 SQLite 迁移到 PostgreSQL / MySQL：
1. 使用 `sqlite3 menu.db .dump` 导出 SQL
2. 在目标数据库执行导出的 SQL 即可

前端 JSON 导出/导入功能也始终可用，作为额外的数据安全保障。

## 7. 常见问题

**Q: 朋友访问时页面空白？**
A: 检查内网穿透是否正常工作；确认 `.env.local` 中的 `NEXT_PUBLIC_API_BASE_URL=/api`（同域部署）。

**Q: 如何更换部署电脑？**
A: 复制整个项目目录 + `server/data/menu.db` 到新电脑，重新执行 `npm install` → `npm run build` → `npm run server:start` 即可。

**Q: 多人同时编辑冲突？**
A: 系统采用 Last-Write-Wins（最后写入优先）策略，旧版本可在"变更记录"页面找回。
