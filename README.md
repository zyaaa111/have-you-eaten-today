# 🍚 今天吃了吗

一个帮你解决"今天吃什么"烦恼的轻量级 Web 应用。支持菜单管理、随机抽选、组合模板、历史记录和多设备同步，可安装为 PWA 在手机上使用。

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

开发服务器默认绑定 `0.0.0.0:3000`，同一局域网内的手机或其他设备可直接通过本机 IP 访问。

### 生产构建

```bash
npm run build
npm run start
```

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
`package.json` 中的脚本已绑定 `-H 0.0.0.0`：

```bash
npm run dev   # 或 npm run start
```

手机/其他设备通过 `http://<你的IP>:3000` 即可访问。

### 内网穿透（如 cpolar）
`next.config.js` 已配置 `allowedDevOrigins`，支持 `*.cpolar.cn` 和 `*.nas.cpolar.cn` 域名下的 HMR WebSocket 连接，避免开发模式下出现 `WebSocket 1006` 报错。

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
├── lib/                    # 工具函数、数据库客户端
├── server/                 # 服务端逻辑、SQLite 数据库文件
├── public/                 # 静态资源、PWA manifest
└── tests/                  # 测试用例
```

---

## 📝 更新日志

- **2025-04-13** — 项目初始化并推送至 GitHub
  - 后端迁移：Express → Next.js API Routes
  - 修复移动端 Modal 滚动问题
  - 优化弹窗 UI 样式
  - 支持局域网访问与 cpolar 内网穿透
  - 完成 40 项单元测试

---

## 📄 开源协议

[MIT](LICENSE)

---

> 如果这个项目帮你解决了"今天吃什么"的纠结，欢迎点个 ⭐️ Star！
