# 🍚 今天吃了吗

一个帮你解决"今天吃什么"烦恼的轻量级 Web 应用。支持菜单管理、随机抽选、组合模板、历史记录和多设备同步，可安装为 PWA 在手机上使用。

![Version](https://img.shields.io/badge/version-1.0.6-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite)

---

## ✨ 功能特性

### 🎲 随机抽选
- **自己做**：从菜谱菜单中随机抽取今日菜品
- **叫外卖**：从外卖菜单中随机抽取
- **组合模板**：自定义规则抽取，如"一荤一素一汤"

### 📝 菜单管理
- 添加 / 编辑 / 删除菜品
- 为菜品设置标签（如：川菜、快手菜、汤）
- 记录所需材料和烹饪步骤
- 支持标签筛选和搜索

### 🏷️ 标签与模板
- 灵活的标签体系，便于分类和筛选
- 组合模板支持按标签规则批量抽选

### 📜 历史记录
- 自动记录每次抽选结果
- 查看"今天吃了什么"以及过往历史

### 🔄 多设备同步
- 通过 **Space ID** 加入同一空间
- 多台设备共享同一份菜单和数据
- 支持匿名加入，无需注册账号

### 📱 PWA 支持
- 可安装到手机桌面，离线也能使用基础功能
- 针对移动端优化了弹窗滚动和触控体验

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | [Next.js](https://nextjs.org/) 14 (App Router) + [React](https://react.dev/) 18 |
| 语言 | [TypeScript](https://www.typescriptlang.org/) |
| 样式 | [Tailwind CSS](https://tailwindcss.com/) + shadcn/ui 风格组件 |
| 数据库 | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)（单文件 SQLite） |
| 客户端存储 | [Dexie.js](https://dexie.org/) (IndexedDB) |
| PWA | [next-pwa](https://github.com/shadowwalker/next-pwa) |
| 测试 | [Vitest](https://vitest.dev/) + [jsdom](https://github.com/jsdom/jsdom) |

当前生产架构是 `Next.js App Router + app/api/* Route Handlers + IndexedDB(Dexie) + SQLite(better-sqlite3)`。

---

## 🚀 快速开始

### 环境要求
- [Node.js](https://nodejs.org/) 18+
- npm / yarn / pnpm

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/zyaaa111/have-you-eaten-today.git
cd have-you-eaten-today

# 2. 安装依赖
npm install

# 3. 开发模式运行（支持局域网访问）
npm run dev
```

默认访问地址为 `http://localhost:3000`。

### 生产构建

```bash
npm run build
npm run start
```

### API 地址配置

- 同域部署时可以不配置 `NEXT_PUBLIC_API_BASE_URL`，前端默认会请求 `/api`
- 如果需要请求独立 API 域名，可在构建前设置 `NEXT_PUBLIC_API_BASE_URL=https://example.com/api`
- `NEXT_PUBLIC_*` 变量会在构建时注入浏览器代码，修改后必须重新执行 `npm run build`

---

## 🗄️ 数据库说明

本项目使用 **SQLite 单文件数据库**，数据文件位于：

```
server/data/menu.db
```

- 数据库已配置 WAL 模式，性能更好
- 包含触发器自动记录变更日志 (`change_logs`)
- **数据不会被 Git 追踪**，升级代码时不会覆盖已有数据
- 迁移数据时，只需复制 `server/data/menu.db`（连同 `-wal`、`-shm` 文件更安全）到新环境即可

---

## 🌐 局域网 / 内网穿透访问

### 局域网访问
手机/其他设备能否直接通过局域网访问，取决于你的运行环境、主机防火墙和端口暴露方式。最稳妥的共享方式仍然是通过内网穿透把 3000 端口暴露出去。

### 内网穿透（如 cpolar）
`next.config.js` 已配置 `allowedDevOrigins`，支持 `*.cpolar.cn` 和 `*.nas.cpolar.cn` 域名下的 HMR WebSocket 连接，避免开发模式下出现 `WebSocket 1006` 报错。

生产环境建议使用：

```bash
npm run build
npm run start
```

如果是同域部署，不需要额外设置 API base；如果改过 `NEXT_PUBLIC_API_BASE_URL`，请在重新 build 后再启动。

---

## 🧪 测试

```bash
# 运行测试
npm run test

# CI 模式运行
npm run test:run
```

---

## 📂 项目结构

```
have-you-eaten-today/
├── app/                    # Next.js App Router
│   ├── api/                # API Routes（数据同步、空间、变更日志）
│   ├── changelog/          # 变更日志页面
│   ├── history/            # 历史记录页面
│   ├── join/               # 加入空间页面
│   ├── menu/               # 菜单管理页面
│   ├── random/             # 随机抽选页面
│   ├── settings/           # 设置页面
│   ├── tags/               # 标签管理页面
│   ├── templates/          # 组合模板页面
│   └── page.tsx            # 首页
├── components/             # React 组件
├── lib/                    # 工具函数、客户端 DB 与同步逻辑
├── server/                 # SQLite 数据文件
├── public/                 # 静态资源、PWA manifest
└── lib/__tests__/          # Vitest 测试用例
```

---

## 📝 版本与更新日志

当前版本：**v1.0.6**

完整更新日志请查看 [CHANGELOG.md](./CHANGELOG.md)。

---

## 📄 开源协议

[MIT](LICENSE)

---

> 如果这个项目帮你解决了"今天吃什么"的纠结，欢迎点个 ⭐️ Star！
