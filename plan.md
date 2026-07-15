# Violoop Cloudflare Workers + Hono + IndexedDB 重构计划

> 状态：Fastify 已拆除；本地 IndexedDB + Hono Worker 为唯一产品路径
> 目标版本：v1（本地优先、无账号、Worker 无状态代理）  
> 包管理器：**pnpm**  
> 本计划以当前 Vitest 测试所固定的业务行为为基线。迁移可以改变运行时和数据边界，但不能无意改变会话、Tactics、状态推进、Provider 适配器、错误处理和 UI 工作流的业务语义。

## 1. 目标与最终架构

### 1.1 产品目标

- 前端静态资源和 API 部署到 Cloudflare Workers。
- 后端 HTTP 框架使用 Hono，使用 Web Standard `Request`/`Response`。
- 会话、消息、配置、Provider、Tactics、状态定义和 usage 默认存储在浏览器 IndexedDB。
- Worker 不保存用户会话，也不依赖本地文件系统、Node.js `fs/path/crypto` 或进程内持久状态。
- 所有 Provider 请求经同源 `/api` Worker proxy 发出，解决 Provider CORS，并统一处理错误和流式/结构化响应。
- 提供数据导出和导入，导出的默认内容不包括 API Key。
- 保留当前业务规则：session profile、能力开关、Tactics 最多注入五个、状态上下文、day progression、scene event、compaction 语义、Provider thinking/cache 适配和错误文案。

### 1.2 最终拓扑

```text
Browser React
  ├─ IndexedDB (conversations, timeline, config, providers, tactics, states, usage)
  ├─ local repositories / domain workflows
  ├─ export/import
  └─ same-origin fetch /api/*
                  │
                  ▼
Cloudflare Worker (Hono)
  ├─ GET  /api/health
  ├─ POST /api/chat                 stateless provider proxy
  ├─ POST /api/providers/test       stateless provider proxy
  ├─ request validation / limits / CORS policy
  ├─ SSRF-safe provider URL validation
  └─ static asset fallback
                  │
                  ▼
          OpenAI-compatible provider
```

Worker 只接收一次请求需要的 provider、prompt blocks、messages 和 chat 选项；它不读取也不写入 IndexedDB。浏览器在收到结果后负责写入本地仓库。

## 2. 迁移原则

1. **先固化业务，再替换边界**：现有 Vitest 是行为契约，不为了迁移而删除或放宽断言。
2. **纯逻辑优先**：prompt assembly、Provider request body、SSE 解析、Tactics scoring、状态 patch、export validation 尽量放在无 Node 依赖的模块。
3. **存储依赖反转**：业务服务通过 repository 接口访问数据；Node JSONL 只是迁移期测试/兼容实现，最终 Worker 构建不得包含它。
4. **不保留旧产品 API 作为永久设计**：迁移期可以保留 Node app 供现有测试和本地迁移，但前端生产路径只使用 IndexedDB + Hono proxy。
5. **密钥最小暴露**：导出默认删除 `apiKey`；UI 必须说明本地配置仍可被当前浏览器读取。Worker 不记录请求体和密钥。
6. **每个阶段都可验证**：每次改动使用 `pnpm test`、必要时 `pnpm test:coverage`、`pnpm build`、`pnpm biome check .`。
7. **不使用 npm**：依赖和脚本全部通过 `pnpm` 修改和执行；保留用户已有的 `package.json`/lockfile 改动，不回滚无关修改。
8. **本地回合副作用同步完成（正式语义）**：IndexedDB 主路径上，compaction 与 day 推进后的 daily state update **在同一次 chat turn 内 await 完成**，并进入本次返回/写入；不以旧 Fastify 的响应后 `schedule*` 火忘为契约。旧服务端异步调度仅作迁移期遗留行为，删除 Fastify 时不必回对齐。

## 3. 数据设计

### 3.1 IndexedDB 数据库

- 数据库名：`violoop`
- schema version：`1`
- object stores：
  - `meta`：schema、迁移标记、最近导出时间
  - `config`：单键 `current`
  - `conversations`：`ConversationSummary`，keyPath `id`
  - `timelineItems`：`TimelineItem`，keyPath `id`，index `conversationId` + `createdAt`
  - `compactions`：`StoredCompaction`，keyPath `id`，index `conversationId`
  - `sessionClocks`：`SessionClock`，keyPath `conversationId`
  - `sessionTactics`：`{ conversationId, tacticIds }`，keyPath `conversationId`
  - `sessionStates`：`{ conversationId, states }`，keyPath `conversationId`
  - `tactics`：`Tactic`，keyPath `id`
  - `stateDefinitions`：`StateDefinition`，keyPath `id`
  - `tacticRuns`：`TacticRunLogEntry`，keyPath `id`，index `conversationId` + `createdAt`
  - `usage`：`{ requestId, usage }`，keyPath `requestId`

Repository 必须提供事务边界；删除会话必须原子删除其 timeline、compaction、clock、tactics、states 和 tactic runs。时间排序统一使用 ISO 字符串。

### 3.2 导出格式

```ts
{
  format: "violoop-export",
  schemaVersion: 1,
  exportedAt: string,
  config: VioloopConfig,
  providers: Record<string, ProviderConfigWithoutSecrets>,
  tactics: Tactic[],
  stateDefinitions: StateDefinition[],
  conversations: ConversationExport[]
}
```

每个 conversation 包含 summary、timelineItems、compactions、clock、sessionTacticIds、userState、tacticRuns。导出通过 Zod 严格校验；默认递归剥离 `apiKey`，导入不覆盖已有数据，采用“同 id 替换/整体导入前校验”的明确策略，并在 UI 中显示预览和结果。第一版提供 JSON 下载、JSON 文件选择、导出空数据、非法 JSON、错误 schema、过大文件和 IndexedDB 失败的业务错误。

## 4. Worker API 契约

### `GET /api/health`

返回 `{ "ok": true }`。

### `POST /api/chat`

请求：

```ts
{
  provider: ProviderConfig + resolved model,
  messages: ChatMessage[],
  promptBlocks: PromptBlock[],
  temperature?: number,
  thinkingLevel?: ThinkingLevel,
  cache?: ChatConfig["cache"]
}
```

Worker 使用 Provider adapter 调用 OpenAI-compatible `/chat/completions`，消费 SSE，并返回：

```ts
{ text: string, usage?: ChatUsage }
```

Worker 不接收 conversationId，不写消息，不执行 compaction，不产生 session state 副作用。浏览器负责把模型 JSON 解析为 timeline/runtime actions，然后持久化。

### `POST /api/providers/test`

请求带 `providerId`、`provider`、`model`；返回现有 `ProviderTestResponse`。错误保持现有 status/detail/error 语义。

### 安全限制

- provider `baseUrl` 仅允许 `https:`；本地开发允许明确配置的 `http://localhost`。
- 拒绝 credentials、非标准协议、localhost/内网/Cloudflare 内部地址和危险端口（开发测试除外）。
- 请求 body、message/context 总大小、Provider response 总大小和上游超时设上限。
- `redirect: "error"`，不把 API key 写入日志、错误响应或导出文件。
- 生产使用同源访问；开发环境由 Vite `/api` proxy 转到 Hono dev server。

## 5. 执行阶段

### Phase 0：基线和文档

- 保存本文件。
- 记录当前 `pnpm test`、`pnpm test:coverage`、`pnpm build`、`pnpm biome check .` 结果。
- 确认现有用户改动（当前 `package.json`/`pnpm-lock.yaml` 的 npm 改动）不被回滚。

### Phase 1：运行时和包结构

- 通过 `pnpm add hono`，必要时 `pnpm add -D wrangler @cloudflare/vite-plugin`（仅在实际使用前添加）。
- 增加 `src/worker/index.ts`、`wrangler.toml` 和 Worker 类型配置。
- 将 Provider adapter 的 Web Standard 部分抽到无 Node 依赖模块；Node app 继续使用同一 adapter，避免业务分叉。
- 实现 Hono error handler、health、chat proxy、provider test proxy。
- 增加 Hono route 测试，覆盖成功、上游非 2xx、无 body、畸形 SSE、usage、thinking/cache options、Provider URL 拒绝和异常错误。

### Phase 2：IndexedDB core repository

- 新增 `src/web/shared/storage/`：数据库打开/升级、事务 helper、repository 类型和错误。
- 使用原生 IndexedDB API，避免不必要的运行时依赖；测试环境使用 fake IndexedDB 测试替身或最小可控 mock。
- 把当前 JSON/JSONL projection 语义实现为 local repositories；保持 normalize、排序、隐藏消息计数、prune、rename、delete、compaction、session clock/state/tactic 规则。
- 给 repository 增加 100% 分支测试，包括首次建库、重复初始化、缺失记录、删除级联、事务失败和 schema upgrade。

### Phase 3：前端迁移到本地数据

- `conversation` API boundary 改为 repository facade，不再请求 `/api/conversations`。
- `config` facade 改为 IndexedDB，首次启动从 `public/default-data` 或内置 seed 初始化；不再依赖 Worker 文件。
- `tactic` facade 改为 IndexedDB，保留创建/更新/删除和 state dependency 业务错误。
- `usage` 改为本地 repository。
- 更新 workflows，让 UI 仍使用原有 public slice API；不让组件直接依赖 IndexedDB 或后端 response contract。
- 新建 session 时在浏览器完成 required states、allowed tactics、clock 和 opening scene 所需的 model 请求。

### Phase 4：无状态聊天客户端

- 将 prompt assembly 和 runtime/tactic 纯逻辑迁入 shared/web 可复用模块，或创建无 Node 的等价 domain service；现有 server tests 继续覆盖相同规则。
- `sendChatMessage` 从本地读取 conversation/context/config/provider/tactics/states，组装 prompt，调用 `/api/chat`，解析 structured result。
- 浏览器写入 user item、assistant items、day transition、scene、state update、usage 和 compaction。
- edit-last 先本地更新并 prune，再发相同上下文的新请求；失败恢复本地快照。
- 保持 `useChatSession` 的状态、错误、last usage、last tactic ids 和 day refresh 行为。
- 删除旧前端对 conversation/config/tactics server CRUD 的调用。

### Phase 5：导入导出 UI

- 增加 export/import domain service 和按钮，放在现有 Config modal 的 Settings 区域。
- 导出默认脱敏 API keys；显示导出成功、空数据、导入预览、冲突和失败结果。
- 导入前做完整 schema 校验和快照；导入失败不改变现有库。
- 增加测试：脱敏、round-trip、旧/未知版本拒绝、冲突、损坏文件和 UI wiring。

### Phase 6：静态资源和部署

- Vite 构建 React 静态资源；Worker 使用 Cloudflare assets fallback 返回 `index.html`。
- 本地脚本：`pnpm dev` 同时启动 Vite 和 Hono dev server；`/api` 由 Vite 代理。
- 部署脚本：`pnpm deploy` 使用 `pnpm exec wrangler deploy`；不使用 npm/npx。
- README 更新 Cloudflare 登录、变量/secret、开发、测试、部署、数据备份和 API key 风险说明。
- 移除生产构建路径对 Fastify、Node fs、seed 文件和 JSONL 的依赖；迁移脚本仅作为显式本地导入工具保留。

## 6. 测试策略与完成条件

### 必须保留的业务覆盖

- 当前 `tests/server` 对 config、conversations、tactics、runtime、compaction、prompt assembly、Provider streaming 和错误边界的行为断言。
- 当前 `tests/web` 对 API boundaries、business models、workflows、modal wiring、UI 交互的断言；迁移后将 endpoint mock 改为 repository/Worker mock，但断言业务结果而不是实现细节。
- 新增 Worker、IndexedDB、export/import、SSRF validation 的测试。

### 每阶段命令

```powershell
pnpm test
pnpm test:coverage
pnpm build
pnpm biome check .
```

coverage 继续保持 lines/functions/branches/statements 100%。生成的 `coverage/` 在 Biome 检查前删除。

### Definition of Done

- `pnpm test:coverage` 100% 通过。
- `pnpm build` 通过，Worker 和 web 类型检查通过。
- `pnpm biome check .` 通过。
- 浏览器刷新后可恢复本地会话；删除会话不会留下孤儿记录。
- 浏览器可导出并导入完整数据，默认导出不含 API key。
- 部署后 `/api/health`、Provider test、chat proxy 和 SPA fallback 可用。
- Worker bundle 不引用 `node:fs`、`node:path`、JSONL 存储或 Fastify。
- README 和错误提示明确说明 IndexedDB 本地存储、无跨设备同步和备份责任。

## 7. 当前实施记录（2026-07-15）

已落地：

- IndexedDB + Hono Worker 本地优先主路径；`pnpm dev` 仅启动 Vite + Wrangler Worker。
- 前端 API facade 仅走本地仓库（不再 fallback 到 Fastify CRUD）。
- **Fastify / Node JSONL 后端已从代码树删除**；保留 `src/server/providers` 与 `services/providerTest` 供 Worker 使用。
- 移除 `fastify`、`@fastify/cors`、`tsx`、`dev:api`、`seed` / `seed:force`。
- `pnpm test:coverage` 覆盖率 include 收缩为 shared + providers + providerTest + worker + web。
- 本地 chat 正式语义：compaction 与 daily state 同轮同步完成（原则 8）。
- 浏览器 seed：`public/default-data/`。

后续可选：

- 将 `src/server/providers` 挪到更中性路径（如 `src/providers`），避免遗留 “server” 命名。
- Cloudflare 部署验证与 README 运维说明打磨。

## 8. 已知限制和后续版本

- v1 不提供跨设备同步、登录和云端会话。
- API key 为本地浏览器配置，Worker proxy 只能隐藏 Provider CORS/URL，不能对 XSS 或本机用户保密。
- 如果未来需要账号、云端备份或团队共享，新增 D1/R2；IndexedDB 作为离线缓存，不在本计划中偷偷引入远端持久化。
- 与旧 Fastify 的**时序**差异是故意的：本地路径同轮完成 compaction / daily state；旧路径在 HTTP 返回后再异步执行。功能语义保留，完成时机以本地路径为准。
