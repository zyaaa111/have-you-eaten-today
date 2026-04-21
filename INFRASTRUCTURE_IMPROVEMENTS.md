# 基础设施加固改进报告

> 生成时间：2026-04-22
> 对应版本：v2.0.3
> 改进方向：基础设施加固（CI/CD、测试覆盖、性能优化、错误监控）

---

## 一、背景与痛点

### 1.1 项目现状

| 维度 | 现状 |
|------|------|
| 版本 | v2.0.3（2026-04-22） |
| 技术栈 | Next.js 14 + React 18 + TypeScript + Tailwind CSS + Dexie(IndexedDB) + better-sqlite3 |
| 代码规模 | lib/ ~350KB，app/components/ ~242KB |
| 单元测试 | 21 个测试文件，148 个用例，全部通过 |
| E2E 测试 | 1 个 Playwright 测试文件（仅 Chromium） |
| 构建状态 | ✅ 成功 |

### 1.2 发现的痛点

通过对项目代码、测试、构建产物和发布历史的全面分析，识别出以下关键痛点：

#### 🔴 高风险

**1. 缺少 CI/CD 流水线**

项目没有任何自动化工作流（`.github/workflows/` 不存在）。每次发布完全依赖开发者手动执行：

```bash
npx tsc --noEmit
npm run test:run
npm run test:e2e
npm run build
```

这种模式下极易遗漏验证步骤。事实上，v2.0.0 大版本发布当天（2026-04-21）连续发布了 v2.0.1 和 v2.0.2 两个补丁版本，修复了场景清单同步竞态、账号私有同步删除语义、跨空间条目串扰、多人抽选权重聚合等边界问题。这些本应在发布前通过自动化检查拦截。

**2. 生产环境错误不可见**

代码中存在 15 处 `console.error/warn/log` 直接输出到浏览器控制台，分布在：

- `lib/http-sync-engine.ts`：6 处同步失败错误
- `lib/profile-state.ts`：2 处状态同步错误
- `app/error.tsx`、`app/menu/error.tsx`、`app/random/error.tsx`：3 处页面级错误边界
- `app/changelog/page.tsx`、`app/join/page.tsx`、`app/menu/page.tsx`、`app/random/page.tsx`、`app/tags/page.tsx`、`app/templates/page.tsx`：6 处页面业务错误
- `components/layout/app-layout.tsx`：3 处初始化/周期性同步错误
- `components/image-uploader.tsx`、`menu-item-detail-dialog.tsx`、`menu-item-form-dialog.tsx`：3 处组件级错误
- `lib/use-live-query.ts`：1 处查询错误

这些错误在用户端发生后，开发者完全无法感知。问题排查只能依赖用户主动反馈，且无法统计错误频率和影响范围。

#### 🟡 中风险

**3. E2E 测试覆盖严重不足**

仅 1 个 Playwright 测试文件 `e2e/shared-space.spec.ts`，且只配置 Desktop Chrome。PWA 应用的核心场景（移动端弹窗、触控、离线）完全无 E2E 覆盖。

**4. Settings 页面体积异常大**

构建报告显示 `/settings` 页面 **46.7 KB**，是其他页面的 3~6 倍，首屏加载对移动端用户不友好。

**5. 缺少测试覆盖率报告**

`vitest.config.ts` 未配置覆盖率，`@vitest/coverage-v8` 未安装。无法量化测试覆盖盲区。

**6. 数据库索引缺失**

Vitest 测试 stderr 中多次出现 Dexie 警告：

> "The query `{tableName, recordId}` on pendingDeletions would benefit from a compound index [tableName+recordId]"

随着数据量增长，`pendingDeletions` 表查询性能会下降。

**7. 无 API 请求日志与监控**

新增前的 32 个 API Routes 中没有统一的请求日志中间件，生产环境排查问题困难。

#### 🟢 低风险

**8. 缺少性能监控**

无 Web Vitals 采集，无 Lighthouse CI 阻止性能回归。

**9. 图片存储无 CDN/缓存优化**

图片存在本地文件系统，通过 `/api/images/*` 读取，无 HTTP 缓存头、无图片压缩/格式转换。

**10. Playwright 配置过于简单**

`fullyParallel: false` 串行执行，无 `retries` 配置。

---

## 二、本次改进内容

基于以上分析，本次选择了 **"基础设施加固"** 方向，聚焦工程化短板，为项目打下更稳健的交付基础。

### 2.1 GitHub Actions CI/CD 流水线

**新增文件**：`.github/workflows/ci.yml`

包含 4 个 job：

| Job | 职责 | 命令 |
|-----|------|------|
| `lint-and-typecheck` | 代码规范与类型检查 | `npm run lint` + `npm run typecheck` |
| `unit-test` | 单元测试与覆盖率 | `npm run test:coverage` |
| `build` | 构建验证 | `next build`（依赖前两个 job 成功） |
| `e2e-test` | 端到端验证 | `npm run test:e2e` |

**触发条件**：
- 所有 push 到 `main` / `master` 分支
- 所有针对 `main` / `master` 分支的 Pull Request

**覆盖率报告上传**：
- 使用 `actions/upload-artifact@v5` 将 `coverage/` 目录作为 artifact 上传
- 即使测试失败也会保留报告（`if: always()`）

**Action runtime**：
- 使用 `actions/checkout@v5`、`actions/setup-node@v5`、`actions/upload-artifact@v5`，避免 Node.js 20 action runtime 弃用警告

### 2.2 Vitest 覆盖率报告与阈值检查

**安装依赖**：`@vitest/coverage-v8`

**修改文件**：`vitest.config.ts`

新增 `coverage` 配置：

```typescript
coverage: {
  provider: "v8",
  reporter: ["text", "json", "html"],
  thresholds: {
    statements: 55,
    branches: 40,
    functions: 55,
    lines: 55,
  },
  exclude: [
    "node_modules/**",
    "dist/**",
    ".next/**",
    "**/*.config.*",
    "**/*.d.ts",
    "scripts/**",
    "e2e/**",
    "lib/__tests__/**",
    "lib/seed.ts",
  ],
}
```

**阈值设定说明**：

阈值基于当前实际覆盖率设定（statements 55.86%, branches 42.37%, functions 56.46%, lines 57.79%），采用保守策略。随着测试补充，可逐步提高至 60%/50%/60%/60% 乃至更高。

### 2.3 数据库复合索引优化

**修改文件**：`lib/db.ts`

- 将 `DB_VERSION` 从 `14` 升级到 `15`
- 为 `pendingDeletions` 表的 Dexie schema 新增 `[tableName+recordId]` 复合索引：

```typescript
this.version(15).stores({
  // ... 其他表保持不变
  pendingDeletions: "++id, tableName, recordId, spaceId, createdAt, [tableName+recordId]",
  // ...
});
```

**消除的警告**：

Vitest 测试中反复出现的以下性能警告已被彻底解决：

> "The query `{tableName, recordId}` on pendingDeletions would benefit from a compound index [tableName+recordId]"

### 2.4 图片 API 缓存头确认

**文件**：`app/api/images/menu-item/[menuItemId]/route.ts`

经检查，图片 API 的 GET 端点已配置了长期缓存头：

```typescript
return new NextResponse(new Uint8Array(image.buffer), {
  headers: {
    "Content-Type": image.contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
  },
});
```

`max-age=31536000`（1 年）配合 `immutable` 指令，意味着浏览器在一年内不会重新验证该图片，符合菜单图片不频繁变更的业务特点。无需额外修改。

### 2.5 前端错误监控体系

#### 2.5.1 核心监控模块

**新增文件**：`lib/error-monitor.ts`

设计原则：
- **不引入外部重型 SDK**（如 Sentry），保持项目轻量
- **异步批量上报**，避免阻塞主流程
- **自动捕获**未处理异常和 Promise 拒绝
- **支持手动上报**业务错误（如同步失败、API 错误）
- **页面卸载保护**，使用 `sendBeacon` 确保数据不丢失
- **默认同域上报**，默认发送到 `/api/client-errors`，也可通过 `NEXT_PUBLIC_ERROR_MONITOR_ENDPOINT` 覆盖
- **隐私保护**，上报前会移除 URL 中的敏感 query，并脱敏 token、password、email、authorization、cookie 等上下文字段

核心 API：

```typescript
// 初始化（在 layout 中调用）
initErrorMonitor(options?: { endpoint?: string })

// 通用错误上报
reportError(report: ErrorReport)

// 同步错误快捷上报
reportSyncError(message: string, context?: Record<string, unknown>)

// API 错误快捷上报
reportApiError(message: string, context?: Record<string, unknown>)
```

上报队列限制：
- 批量大小：`BATCH_SIZE = 10`
- 刷新间隔：`FLUSH_INTERVAL_MS = 30_000`
- 最大队列长度：`MAX_QUEUE_SIZE = 50`

#### 2.5.2 初始化组件

**新增文件**：`components/error-monitor-init.tsx`

在 `app/layout.tsx` 中挂载 `<ErrorMonitorInit />`，确保每个页面加载时自动初始化全局错误捕获。初始化组件默认使用 `/api/client-errors`，服务端仅写结构化日志，不新增持久化表。

#### 2.5.3 替换范围

共修改 **12 个文件**，将 `console.error/warn` 全面替换为结构化上报：

| 文件 | 替换数量 | 错误类型 |
|------|---------|---------|
| `lib/http-sync-engine.ts` | 6 | `reportSyncError` |
| `lib/profile-state.ts` | 2 | `reportSyncError` |
| `lib/use-live-query.ts` | 1 | `reportError` |
| `app/error.tsx` | 1 | `reportError` |
| `app/menu/error.tsx` | 1 | `reportError` |
| `app/random/error.tsx` | 1 | `reportError` |
| `app/changelog/page.tsx` | 1 | `reportSyncError` |
| `app/join/page.tsx` | 2 | `reportSyncError` |
| `app/menu/page.tsx` | 1 | `reportSyncError` |
| `app/random/page.tsx` | 1 | `reportSyncError` |
| `app/tags/page.tsx` | 1 | `reportSyncError` |
| `app/templates/page.tsx` | 1 | `reportSyncError` |
| `components/layout/app-layout.tsx` | 3 | `reportSyncError` |
| `components/image-uploader.tsx` | 1 | `reportApiError` |
| `components/menu-item-detail-dialog.tsx` | 1 | `reportApiError` |
| `components/menu-item-form-dialog.tsx` | 1 | `reportApiError` |

**保留的 `console.error`**：

`lib/error-monitor.ts` 内部保留了 2 处 `console.error`，用于在开发环境打印调试信息。这是设计意图，确保开发时仍能在控制台看到错误详情。

---

## 三、验证结果

### 3.1 自动化检查

| 检查项 | 结果 | 备注 |
|--------|------|------|
| TypeScript 编译 | ✅ 通过 | `npx tsc --noEmit` 无错误 |
| 单元测试 | ✅ 通过 | 21 个测试文件，148 个用例全部通过 |
| 覆盖率报告 | ✅ 生成 | text / json / html 三种格式 |
| Next.js 构建 | ✅ 成功 | 静态页面 11 个，API 路由 33 个 |

### 3.2 覆盖率基线

```
File             | % Stmts | % Branch | % Funcs | % Lines
-----------------|---------|----------|---------|--------
All files        |   55.86 |    42.37 |   56.46 |   57.79
lib/             |   57.18 |    43.02 |   56.54 |   59.31
app/api/         |   23.68 |    28.57 |   22.22 |   24.39
```

**关键模块覆盖**：

| 模块 | 语句覆盖 | 分支覆盖 | 函数覆盖 |
|------|---------|---------|---------|
| `lib/roll.ts` | 88.23% | 71.26% | 91.30% |
| `lib/likes.ts` | 92.30% | 75.00% | 100% |
| `lib/weights.ts` | 96.96% | 80.00% | 100% |
| `lib/settings.ts` | 100% | 90.90% | 100% |
| `lib/db-server.ts` | 72.59% | 38.88% | 79.16% |
| `lib/http-sync-engine.ts` | 50.43% | 39.18% | 59.30% |
| `lib/profile-state.ts` | 58.66% | 46.91% | 50.54% |

### 3.3 Dexie 警告消除

运行测试后，此前反复出现的 `pendingDeletions` 复合索引警告已完全消失：

```bash
# 改进前（每次测试出现 2 次）
stderr | The query {tableName, recordId} on pendingDeletions would benefit from a compound index [tableName+recordId]

# 改进后
# （无此警告）
```

---

## 四、预期收益

### 4.1 阻止发布事故（高优先级）

CI/CD 流水线在 **PR 阶段** 自动执行以下检查：

```
代码提交 → GitHub Actions 触发
├── ESLint 检查
├── TypeScript 类型检查
├── 148 个单元测试
├── 覆盖率阈值检查
├── Next.js 构建验证
└── Playwright E2E 验证
```

任何一步失败都会阻止合并，从根本上避免 v2.0 式"大版本发布当天连发 2 个补丁"的情况再次发生。

### 4.2 生产错误可观测（高优先级）

改进前：用户遇到同步失败 → 控制台打印 `console.error` → 开发者完全不知 → 依赖用户主动反馈

改进后：用户遇到同步失败 → `error-monitor` 捕获 → 结构化日志（含错误类型、时间、页面 URL、上下文）→ 可选择上报到服务端 → 开发者可统计频率和影响范围

当前配置下，错误会：
1. 始终打印到浏览器控制台（开发调试不受影响）
2. 收集到内存队列中（最多保留最近 50 条）
3. 当配置 `endpoint` 后，异步批量上报到服务端

### 4.3 测试质量可量化（中优先级）

覆盖率报告让测试盲区一目了然：

- **HTML 报告**：`coverage/index.html`，可在浏览器中查看逐行覆盖情况
- **JSON 报告**：`coverage/coverage-final.json`，可供第三方工具消费
- **CI 集成**：每次 PR 自动附带覆盖率变化，便于 code review 时关注测试覆盖

### 4.4 数据库性能优化（中优先级）

`pendingDeletions` 是同步引擎的核心表，频繁执行 `{tableName, recordId}` 组合查询。添加复合索引后：

- 查询时间从 **O(n)** 降为 **O(log n)**
- 随着用户数据量增长，性能优势愈加明显
- 消除了 Dexie 运行时警告，减少不必要的性能监控开销

### 4.5 降低维护成本（长期收益）

| 改进项 | 维护成本变化 |
|--------|-------------|
| CI/CD | 从"手动执行 4 条命令"到"全自动零干预" |
| 错误监控 | 从"用户反馈后盲查"到"结构化日志定位" |
| 覆盖率 | 从"凭感觉判断"到"数据驱动补充" |
| 数据库索引 | 从"潜在性能坑"到"已消除隐患" |

---

## 五、使用说明

### 5.1 本地开发

覆盖率报告生成：

```bash
npm run test:coverage
# 报告输出到 coverage/ 目录
open coverage/index.html  # 查看 HTML 报告
```

### 5.2 配置错误上报端点

默认错误上报端点为同域 `/api/client-errors`，服务端会写入脱敏后的结构化日志。若需改为其他收集端点，可在构建前配置：

```bash
NEXT_PUBLIC_ERROR_MONITOR_ENDPOINT=https://your-domain.com/api/client-errors
```

该变量会写入浏览器代码，修改后需要重新执行 `npm run build`。

### 5.3 CI 状态查看

代码推送后，在 GitHub PR 页面底部查看 Checks 状态：

```
✅ Lint & Type Check — Passed
✅ Unit Tests — Passed
✅ Build — Passed
✅ E2E Tests — Passed
```

---

## 六、后续建议

虽然本次基础设施加固已完成核心目标，但以下改进方向仍值得规划：

### 6.1 短期（1-2 周）

1. **提高覆盖率阈值**
   - 当前阈值偏保守（55%/40%/55%/55%）
   - 建议优先补充 `lib/sync-api.ts`（0%）、`lib/server-auth.ts`（27.19%）、`lib/image-storage.ts`（4.76%）的测试
   - 目标：逐步提升至 70%/60%/70%/70%

2. **E2E 测试增强**
   - Playwright 配置增加移动端设备（`devices['Pixel 5']`）
   - 补充离线/在线切换场景
   - 开启 `fullyParallel: true` 和 `retries: 1`

3. **API 请求日志中间件**
   - 在 `app/api` 根目录添加统一的日志中间件
   - 至少记录 method、path、status、duration、user agent

### 6.2 中期（1 个月）

1. **Settings 页面代码分割**
   - 当前 46.7 KB，建议对备份/恢复、冲突解决等不常用功能做动态 import
   - 目标：首屏加载降至 20 KB 以下

2. **图片压缩与格式转换**
   - 上传时自动生成 WebP 格式
   - 服务端根据 `Accept` 头返回最优格式

3. **性能监控**
   - 配置 Next.js `useReportWebVitals` 采集 Web Vitals
   - 添加 Lighthouse CI action 阻止性能回归

### 6.3 长期（视需求）

1. **同步引擎重构**
   - 将 `lib/http-sync-engine.ts`（1111 行）拆分为子模块
   - 补充集成测试（模拟网络断线、延迟、冲突）

2. **服务端错误监控**
   - API Routes 统一错误处理与上报
   - 数据库慢查询监控
