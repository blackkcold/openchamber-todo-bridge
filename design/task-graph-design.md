# 任务树 / 图谱可视化 + 管理界面 — 设计规格

> 状态：待评审（brainstorming → design 阶段）。经用户确认的四项决策：**数据路线 A**（扩展 todo 项字段）、
> **管理页 v1 = 只读可视化 + 对话操作**、**rail 面做极简面板 + 另设全屏看板**、**"Intelligence UI" 指
> GPT‑6 式富图形化、图标/控件驱动、多维直观的界面**（本方案的落点）。

## 1. 目标与意图

现状：本扩展把 OpenCode 会话的 todo（`todowrite` 写入、插件镜像到
`~/.config/openchamber/todos/<sessionID>.json`）渲染成 Work Status 面板里的**扁平清单**。数据只有
`{ content, status, priority }`，没有层级，因此画不出"树"。

目标：

1. **让 AI 在写 todo 的同时产出结构**：任务树的层级（父/子）与"阶段"（phase），使面板从
   "平淡的清单"升级为**带阶段配色 + SVG 状态符号的动态任务树**——树的生长、进度条、状态符号共同
   构成可一眼识别每个阶段进展的可视化。
2. **新增可视化管理界面**：一个**极简 rail 面板**（当前会话实时树，常驻入口）+ 一个**全屏看板**
   （OpenChamber `page`：跨会话汇总、阶段/状态筛选、节点详情），只读展示 + "交给 AI 处理"（对话操作）。
3. 保持**向后兼容**：旧扁平清单照常工作；无结构的列表优雅降级为现有清单。

设计原则：复用现有模式（纯函数模块 + Node 单测、`--oc-*` 令牌、内联 SVG 不依赖图标字体、行级
DOM 复用现有动画/高度/滚动机制），不发明新约定。

## 2. 非目标（本设计不做）

- 不改 OpenCode 本体，不依赖任何其它插件。
- 不在 v1 让管理页**直接写回** todo 文件（避免与 AI 的整表重写打架）；改动一律走"交给 AI"。
- 不做多用户/服务端存储（用 `host.storage` 存偏好即可）。
- 不做移动端/VS Code（OpenChamber 扩展本身就不在这些端加载）。
- 不引入任何外部运行时依赖（Mermaid、图标字体、CDN 均不打包）。

## 3. 官方约束（已核实）

来源：`docs.openchamber.dev`（Build an extension / Host API / UI kit）、本地 `@openchamber/sdk@2.0.4`
及其 `manifest.d.ts` / `contract.d.ts`。

- **沙箱**：扩展页运行在 `sandbox="allow-scripts"` 的 iframe，CSP 放行 inline JS / `eval` / WASM
  （`dist/frame-policy.js`）。→ 内联 SVG / Canvas 可自由绘制。
- **区块高度**：Work Status 区块 `setHeight` 被钳制在 **24–320px**（`GUEST_STATUS_SECTION_HEIGHT_MIN/MAX`，
  与 `src/viewport.js` 的 `MIN_H/MAX_H` 一致）；超出则页内滚动。`setHeight` 只在 `status` 面生效。
- **全屏页**：`contributes.page` 提供全屏页，但**要求 `panel.entry` 存在**。本扩展当前 `panel`
  无 `entry`（section-only），因此必须先新增一个 `panel.entry`。
- **网络**：无 `fetch`、无 CDN；外部只能经 `integration.request`（单一 `apiOrigin`）或本地 `service`。
  → 图形/图标/字体必须内联或打包。
- **数据**：`host.storage`（JSON，值 ≤64KiB，命名空间 ≤2MiB/2000 键，无权限）；`readFile/writeFile/
  listDir/stat`（限 `contributes.filesystem` glob）。
- **主题**：`applyHostReady(ctx, root)` 写入 56 个 `--oc-*` 令牌（含 `--oc-syntax-keyword/string/number/
  function/type`、`--oc-selection(-fg)`、`--oc-elevated(-fg)`、`--oc-focus`、`--oc-mono`、`--oc-radius`…），
  并设 `data-oc-theme` / `data-oc-surface`。
- **先例**：官方 `git-graph-status` 示例在 **320px 区块内用内联 SVG 画提交泳道图**（行高 36px、
  泳道 10px、最多 8 泳道、颜色取自 `--oc-syntax-*` 带回退、圆点符号）。这是本方案区块可视化的
  直接范式。

## 4. 数据模型 v2

镜像文件继续写在同一路径 `~/.config/openchamber/todos/<sessionID>.json`，新增顶层 `version` 与可选
`phases`，todo 项新增四个**可选**字段：

```jsonc
{
  "version": 2,
  "sessionID": "ses_x",
  "phases": ["调研", "设计", "实现", "验证"],   // 可选：声明阶段顺序（决定配色次序）
  "todos": [
    { "content": "梳理现有渲染管线", "status": "completed", "priority": "medium",
      "id": "t1", "phase": "调研" },
    { "content": "实现树布局", "status": "in_progress", "id": "t2", "parentId": "t1", "phase": "实现" },
    { "content": "肘形连接线", "status": "pending", "id": "t3", "parentId": "t2", "phase": "实现" },
    { "content": "全屏看板", "status": "pending", "id": "t4", "phase": "设计",
      "dependsOn": ["t2"] }
  ],
  "updatedAt": 1699999999999
}
```

字段语义：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string? | 列表内稳定标识。缺省时渲染器按 `content`+出现次序合成 key（与现有 row key 策略一致）。 |
| `parentId` | string \| null? | 父节点 id；缺省 / `null` / 指向不存在 / 自指 / 成环 → 视为根（防御式）。 |
| `phase` | string? | 阶段名，驱动**配色带**与图例。 |
| `dependsOn` | string[]? | 跨分支依赖（图谱视角用，区块树视图可忽略）。 |
| `phases` | string[]? | 顶层：阶段声明顺序，缺省按"首次出现次序"。 |

**向后兼容**：读取端 (`parse`) 容忍 v1（无 `version`／无新字段）；写入端始终写 `version: 2`。旧版本
扩展读 v2 文件时，未知字段被其 `parse` 忽略，仍能显示扁平清单。

**校验**（插件 `normalize`）：新字段若出现则校验类型（`id`/`phase` 非空字符串；`parentId` 为字符串或
null；`dependsOn` 为字符串数组），非法即抛可读错误，让模型自我纠正——与现有状态/优先级校验同风格。

## 5. AI 写入契约（工具描述增补）

`todowrite` 的 `input` schema 增加可选 `id / parentId / phase / dependsOn`，并在
`TODOWRITE_DESCRIPTION` 末尾追加一节（保持简洁，避免削弱工具使用率）：

```
## Structure (optional, for the visual task tree)
- Give each item a short stable `id`; keep it the same across updates.
- Use `parentId` to nest a step under the task it belongs to (a subtask). Leave it out for a top-level task.
- Use `phase` to name the stage a task belongs to (e.g. "调研", "实现", "验证"). Phases are drawn as colour bands.
- `dependsOn: [ids]` records cross-task dependencies (shown in the full task board).
- The panel draws these as a live task tree. A flat list still works, but structure is what makes progress legible.
```

`buildReminder`（每轮注入）在列表仍打开时保持现状；可在其"keep current"段落里加一行提醒结构字段。

## 6. 区块可视化（任务树，≤320px）

### 6.1 形态：缩进树 + 行级 SVG 槽

沿用现有**行级 DOM**模型（`reconcileRows` 的动画/高度/滚动/折叠全部复用）。每行左侧新增一个固定
宽度的 **gutter**，内含一个行内 `<svg>`：画该行的连接线段 + 节点状态符号。右侧仍是 `.txt`，
再右侧是 `.pri`。这正是 `git-graph-status` 的做法（每行一个 `drawRowGraph` SVG），在窄栏里最稳。

```
┌── gutter ──┐
│  │  ✓      │  调研 · 梳理现有渲染管线        ⌃
│  ├─◐       │  实现 · 实现树布局  ← 活动节点（置顶、呼吸）
│  │  ├─○    │  实现 · 肘形连接线
│  └─○       │  设计 · 全屏看板
└────────────┘
```

- 行高：沿用现有 `.item`（padding 3px + 13px 盒 ≈ 21–22px），gutter 图标 11px，居中对齐基线。
- 缩进：`INDENT = 9px / 层`；**深度上限 `MAX_DEPTH = 6`**，超出压缩为同缩进（窄栏保护），并在文本前
  加 `…` 提示被压层。
- 连接线（肘形）：竖向主干 + 进入子节点的横向短段；末子用 `└`，中间子用 `├`。仅当有子节点时画。
- 活动节点（唯一的 `in_progress`）**置顶**（复用现有 `order()` 排名），gutter 符号带呼吸动画，
  树在滚动时自动将其滚入视野（复用现有滚动/回位机制）。

### 6.2 状态符号（内联 SVG，不依赖图标字体）

| status | 符号 | 画法 |
|---|---|---|
| `pending` | 空心圆 | `circle r=3.5 stroke=phase fill=none` |
| `in_progress` | 实心圆 + 呼吸外环 | 实心 `circle` + 外层 `circle` 动画（`stroke-opacity`/`r` 呼吸），配色 `--oc-primary` |
| `completed` | 圆内勾 | 实心圆 + 白色 `path` 勾（与现有 CSS 勾语义一致）+ `todo-tick-in` 入场 |
| `cancelled` | 虚线圆 + 斜杠 | `stroke-dasharray` + 斜线，降不透明度 |

### 6.3 阶段配色（"一眼识别每个阶段"）

阶段 → 颜色，用宿主语法令牌，回退到语义色（沿用 `git-graph-status` 的写法）：

```js
const PHASE_TOKENS = [
  'var(--oc-syntax-keyword, var(--oc-primary))',
  'var(--oc-syntax-string,  var(--oc-info))',
  'var(--oc-syntax-number,  var(--oc-success))',
  'var(--oc-syntax-function,var(--oc-warning))',
  'var(--oc-syntax-type,    var(--oc-error))',
]
```

阶段索引 = `phases` 声明顺序，缺省按首次出现次序；颜色按索引取模。文本行可加一层极淡的 phase
底色（`color-mix(... 10%, transparent)`）作色带，避免喧宾夺主。

### 6.4 头部与图例

- 进度条/计数保持现状（`N/M` + 2px 条）。
- 新增一个**图例行**（可折叠）：阶段色点 + 名称，让"颜色=阶段"无需说明即懂。
- 无任何结构（无 `parentId`/`phase`）时，**回退为现有扁平清单**，并可选地在头部给一个"让 AI 规划成树"
  的提示（不阻塞）。

## 7. 管理界面：极简 rail 面板 + 全屏看板

两个**独立页面**（`page` 要求 `panel.entry` 存在；本扩展先补 `panel.entry`，从 section-only 升级）。
注意：扩展**不能自行打开全屏页**（官方限制），因此 rail 面板必须自身可用，而不是一个"打开看板"的按钮。

### 7.1 两个面与安装清单

- `panel.entry = "panel/index.html"` — **极简 rail 面板**（常驻入口，见 §7.3）。
- `page = { "entry": "board/index.html", "title": "任务图" }` — **全屏看板**（见 §7.2），从 session
  列表上方的 **Extension pages** 菜单打开。
- `filesystem` 保持 `~/.config/openchamber/todos/*.json`（`listDir` 枚举全部会话）+ 插件目录。

### 7.2 全屏看板（`board/index.html`）

```
┌─ 任务图 ───────────────────────────────────────────────┐
│ [阶段筛选▾] [状态: 进行中▾] [搜索__________]   图例 ●阶段 │
├──────────────────────────────┬──────────────────────────┤
│  大画布（SVG 树 / 泳道图）      │  节点详情                 │
│  · 可缩放 / 平移               │  · content / status       │
│  · 树视图 ⇄ 泳道视图切换        │  · phase / dependsOn      │
│  · 活动节点高亮 + 呼吸          │  · 所属会话               │
│  · 跨会话：每会话一棵树          │  [交给 AI 处理]           │
└──────────────────────────────┴──────────────────────────┘
```

- **数据来源**：`listDir('~/.config/openchamber/todos')` → 逐一 `readFile` → 解析 v1/v2 → 每会话一棵
  树 / 一张图。跨会话汇总（哪些会话有活跃工作）。
- **视图**：缩进树为默认；额外提供 **泳道视图**（DAG，`git-graph-status` 范式）以表达 `dependsOn`
  与并行。
- **筛选**：按 phase / status / 关键字。偏好存 `host.storage`（按 `directory` 或 runtime 分区）。
- **只读 + 对话操作**（v1 不写回，见 §7.4）。
- **主题**：`applyHostReady(ctx, document.documentElement)`；用 `@openchamber/sdk/ui` 的
  `mountSelect/mountSearchField/mountTabs/mountBanner` 等搭建控件，使外观与宿主一致（"Intelligence UI"
  的质感来自宿主控件 + 内联 SVG，而非自造样式）。

### 7.3 极简 rail 面板（`panel/index.html`）

刻意做到最小，作为"点开即看"的常驻入口：

- 顶部：当前会话标题 + `N/M` 进度条（与区块一致的头部）。
- 主体：**当前会话**的任务树（缩进树 + 状态符号 + 阶段色带），活动节点置顶并呼吸。
- **无**图例、**无**筛选、**无**跨会话、**无**详情侧栏——这些全在全屏看板里。
- 与区块共用 `graph.js`、`parse`、轮询；区别：面板不受 320px 高度限制，且是"点开才看"的入口。
- 复用同一套行级 SVG 渲染函数，`src/panel.js` 只是一层薄外壳（取当前会话 → 渲染），以保证维护成本低。

### 7.4 操作与能力（capabilities）

- **唯一的操作：`host.compose({ text, mode: "append" })`** —— 把"处理这个节点"的指令放进聊天输入框，
  由用户审阅后自行发送。理由：`compose` **不挂任何能力**、会话忙时仍可用、`append` 不覆盖用户已输入
  内容、且契合"只读 + 对话操作"的保守定位。
- **v1 零新增能力**：只保留既有的 `filesystem`（todos glob）。**不声明 `sessions`、不声明 `prompt`。**
- **不做「打开会话」跳转**（那需要 `sessions`）；看板只在详情里显示节点所属会话的 id/标题文本，不跳转。
- **不直接发送**：「直接发送（`prompt send:true`）」需 `prompt` 能力，留作 **P3 可选项**，届时再显式
  引入并在更新时重新弹批准对话框。

## 8. 架构与模块

```
opencode-plugin/index.js   插件：schema + 校验 + 镜像 v2（+ 工具描述增补）
src/graph.js               【新】纯函数：建树 / 布局 / 阶段配色 / 状态符号（Node 可单测）
src/main.js                区块：接 graph.js，行级 gutter SVG，保留动画/高度/滚动
src/viewport.js            不变（高度/滚动算术）
src/plugin-install.js      不变（继续把插件写入 OpenCode 自动发现目录）
src/panel.js               【新】极简 rail 面板逻辑（当前会话的实时树，薄外壳）
panel/index.html           【新】极简 rail 面板外壳
src/board.js               【新】全屏看板逻辑（列会话、画布、筛选、详情、对话操作、偏好）
board/index.html           【新】全屏看板外壳
status/index.html          区块外壳：新增 gutter 相关 CSS 令牌
scripts/build.ts           多入口打包（status/main.js + panel/main.js + board/main.js），内联插件源
scripts/build-test-extension.ts  同步打包 panel/board，测试清单加 panel/page
```

`src/graph.js` 纯函数接口（草案）：

```js
export function buildTree(todos)      // → { order:[Node], byId:Map, roots:[id], depth:Map, cycles:[...] }
                                      //   父缺失/自指/成环 → 归为根；深度封顶 MAX_DEPTH
export function treeLayout(order)     // → Row[]: { node, depth, isLast, ancestorLast:boolean[] }（肘形标志）
export function phaseColorIndex(phase, phases)  // → 颜色索引
export function statusGlyph(status)   // → 'pending'|'in_progress'|'completed'|'cancelled'
```

**数据流**：OpenCode 会话 → 插件 `todowrite`（写 v2 镜像）→ 区块/全屏页 `readFile` 轮询（区块沿用
2s 轮询；全屏页用 `listDir` + 轮询或 `stat` mtime 变化触发）→ `parse` → `buildTree` → 渲染。

**降级路径**：解析失败 → 现有消息态；无结构 → 扁平清单；父指缺失/成环 → 视为根（绝不空白/崩溃）。

## 9. 构建与清单改动

`package.json`（根，扩展清单）：

```jsonc
"panel": { "id": "todo-bridge", "name": "Todos", "icon": "checkbox-circle", "entry": "panel/index.html" },
"page": { "entry": "board/index.html", "title": "任务图" },
"statusSection": { "entry": "status/index.html", "title": "Todos", "height": 56 },
"filesystem": ["~/.config/openchamber/todos/*.json", "~/.config/opencode/plugins/openchamber-todo-bridge/*"]
```

- 版本：`0.5.1 → 0.6.0`（新功能，minor）。同步改 `opencode-plugin/package.json`（插件版本标记随之，
  触发已装用户重装插件）。
- `scripts/build.ts`：改为对象式多入口
  `entrypoints: { "status/main": "src/main.js", "panel/main": "src/panel.js", "board/main": "src/board.js" }`，
  分别输出到 `status/`、`panel/`、`board/`。插件源仍只内联进 **status** 包（它负责安装；避免多个包都写插件）。
- `scripts/build-test-extension.ts`：同步打包 panel/board、清单加 `panel.entry` + `page`，`status` 保持只读。
- `status/`、`panel/`、`board/` 的 `main.js` 与各自的 `index.html` 均需提交（OpenChamber 不构建扩展）。

## 10. 测试

- `scripts/test-graph.mjs`【新】：`buildTree`（根识别、深度、父缺失/自指/成环、重复 id、深度封顶）、
  `treeLayout`（肘形标志、DFS 次序、末子标记）、`phaseColorIndex`、`statusGlyph`。
- `scripts/test-plugin.mjs`【扩】：`normalize` 接受/拒绝新字段（类型校验）；镜像 v2 形状；`buildReminder`
  含结构提示。
- `scripts/validate.ts`：不变（校验清单）。
- `design/verify.html`【扩】：新增"任务树"窗格（真实 `status/` + 协议桩），覆盖：成树、无结构降级、
  父缺失、成环、长文本换行、深度上限。
- 手动：全屏页在 `bun run build` 后经 `python3 -m http.server` 打开自检（协议桩）。

## 11. 分批实施（供后续 writing-plans 展开）

- **P1 · 数据 + 区块树**：`graph.js` + 插件 schema/校验/镜像 v2 + 工具描述 + 区块行级 SVG 树 +
  单测 + verify.html 树窗格。此阶段即可交付"不再平淡"的核心价值。
- **P2 · 极简面板 + 全屏看板**：`panel.entry` + `page` + `panel.js` / `board.js` + 构建改动 + 测试清单。
- **P3 · 图谱与打磨**：泳道/DAG 视图、`dependsOn` 边、图例、跨会话汇总视图、动画细化。

## 12. 风险与未决问题

| 风险 | 缓解 |
|---|---|
| LLM 维护 `id`/`parentId` 不稳定 | 渲染器容错（父缺失即根、成环即根、深度封顶）；工具描述强约束；无结构时降级扁平清单 |
| 区块 320px 放不下深树 | 活动节点置顶 + 自动滚入视野；缩进上限；全屏页承载大图 |
| 阶段命名发散（"实现"/"impl"混用） | 以 `phases` 声明顺序为规范；缺省按首次出现；图例明示颜色=阶段 |
| 能力面变化 | v1 **零新增能力**（仅既有 `filesystem`），无重新批准；P3 若引入 `prompt` 再 README 说明 |
| 与现有 `status/main.js`（已提交 106KB 构建产物）同步 | 每次改 `src/` 必须重跑 `bun run build` 并提交产物 |

已确认决策（用户，2026‑10‑14）：

1. **阶段语义**：phase 由 **AI 自由命名**（最灵活）；以顶层 `phases` 声明顺序为规范，缺省按首次出现。
2. **区块默认视图**：有结构时**默认树**；无结构时**降级扁平清单**（不做手动切换开关）。
3. **rail 面板**：**另做极简面板**（§7.3），不复用看板窄版；因扩展不能自行打开全屏页。
4. **对话操作默认动作**：v1 只有 **`compose({ mode:"append" })` 放进输入框**，**不新增任何能力**
   （不 `prompt`、不 `sessions`）；**不做「打开会话」跳转**。「直接发送」留作 P3 可选项。

无待定项。spec 已按上述四条定稿；待用户最终修改意见后进入 `writing-plans`。

## 13. 参考

- `docs.openchamber.dev/sdk/`（Build an extension）、`/sdk/host/`（Host API）、`/sdk/ui/`（UI kit）
- 官方示例 `packages/sdk/examples/git-graph-status`（区块内 SVG 泳道图范式）、
  `checklist-editor`（fileEditor 范式）
- 本仓库：`src/main.js`、`src/viewport.js`、`opencode-plugin/index.js`、`status/index.html`、
  `design/README.md`、`design/verify.html`

## 14. P3（已实现）

**修复（根因）**：`planInstall` 改为比较语义化版本，**磁盘上是更新版本则绝不覆盖**——修掉"旧扩展
静默降级新插件"的问题（两个扩展共享同一插件路径）。`scripts/test-install.mjs` 固定该行为。

**① dependsOn**：`graph.js` 的行带 `blocked`（依赖存在且未 completed）。树视图 gutter 画红色虚线环 +
`title`；看板树行加「受阻」胶囊；详情栏列出可点击的依赖并标注「未完成 → 受阻」。

**② 阶段泳道 DAG**：新增纯函数 `src/dag.js`（`dagLayout(todos, phases)`）。
- 列 = 依赖深度：`rank(n)` 无前驱为 0，否则 `max(rank(前驱))+1`，前驱 = 父 ∪ 已解析 dependsOn；
  Kahn 最长路，成环节点保持 rank 0。
- 行 = 阶段泳道：顺序取顶层 `phases`，无阶段的项进尾部「未分组」泳道。
- 同（泳道,列）多节点在泳道内纵向堆叠；节点色 = 状态、泳道底色 = 阶段；实线父边、红虚线依赖边。
- 看板新增视图切换（**任务树 ⇄ 泳道图，默认任务树**）；泳道 SVG 内联、`overflow:auto` 可滚。
- 测试：`scripts/test-dag.mjs`。

**③ 跨会话汇总**：看板顶部 `#summary`——全局统计（会话数 / 进行中 / 待办 / 受阻 / 完成 / 总数）+
各阶段计数；每会话卡片带阶段进度条与 `done/total`。

**会话选择**：看板新增「会话」下拉（**全部会话 / 某一个**），配合「视图」下拉，可按用户需要只看一个
会话或看全部；默认全部 + 任务树视图。

版本 `0.6.0 → 0.7.0`。验证：`bun run test`（test-plugin / test-viewport / test-graph / test-dag /
test-install）全绿；浏览器核对区块受阻环、看板汇总/会话选择/泳道视图（`design/verify-pages.html`）。

## 15. P3 补丁（跳转到会话）

面板与看板的节点详情各加一个**「打开会话」/「跳转到会话」**动作，调用 `host.openSession(sessionID)`
打开任务所属的会话——需要声明 **`sessions`** 能力（安装/更新时会重新弹一次授权）。面板顶栏按钮只在
有当前会话时显示；未授权时点击给出 toast 提示。

看板不再 `listDir` 目录（授权范围是文件级 `todos/*.json`，列目录会 `BAD_PATH`），改读插件写的
**`_index.json` 会话索引**，授权范围不变。

## 16. P0：默认隐藏已完成

新增纯函数 `graph.js#pruneFinished(todos)`：只保留**未完成**的任务，以及**通往未完成任务的祖先**。
一个节点被隐藏，当且仅当它**自身与其整棵子树都已完成**——所以隐藏不会让任何保留下来的任务丢失父节点
（树与泳道图都保持良构）。`finishedCount(todos)` 返回已完成数。

- 区块：树模式下默认修剪，底部一个 **已完成 N 项** 折叠（点开才渲染隐藏行）。
- 面板：同上（`openFinished`，切换会话时重置）。
- 看板：工具栏 **显示已完成** 开关（默认关）；树视图与泳道图都按开关修剪。

测试：`scripts/test-graph.mjs` 新增 `pruneFinished` / `finishedCount` 用例（叶、祖先、整棵子树、计数）。

## 17. 阶段分组（让"只写 phase"的列表也有树）

`buildTree` 在**整个列表都没有 `parentId`** 且存在 `phases` 时，合成一层阶段父节点（每个用到的阶段一个），
把任务挂到各自阶段下；于是只有 `phase`、没有嵌套的列表也会**缩进 + 连线**，而不是一排平铺。有显式
`parentId` 时**不合成**（显式层级优先）。合成节点带 `synthetic: true`，`gutter.js` 给它画一个小方块
（而非状态圆点），渲染层把它画成一行**加粗的阶段标题**（用阶段色）。

测试：`test-graph.mjs` 新增分组用例（每阶段一个合成节点、任务缩进一级、显式嵌套时不合成、无阶段时不合成）。

## 18. 看板窗口化（默认最近 15 个 + 当前会话置顶 + 懒加载）

看板曾每 4s 读**全部**会话镜像、并渲染**全部**会话——会话一多就卡死。改为：

- **数据**：只读插件写的 `_index.json`。索引升级到 `version: 2`：每个会话条目附带**摘要**
  （`title` / `total` / `done` / `doing` / `pending` / `cancelled` / `blocked` / `byPhase` / `phases`），
  由插件写索引时算出（按 mtime 缓存，未变的文件不重读）。于是顶部统计、会话下拉、每张卡的头都
  **零文件读**；只有画某会话的树 / 泳道才 `readFile` 它的镜像。
- **渲染**：`BATCH = 15`。当前会话（`ctx.session`，缺省取最新一个）**置顶成独立卡片**并从列表排除；
  其下按 `_index.json` 倒序渲染最近 15 个会话；底部哨兵用 `IntersectionObserver`（`rootMargin: 600px`）
  加 `#sessions` 滚动兜底，滚到底载入下一批（`loadingMore` 闸门防重复）。
- **筛选**：关键字 / 状态 / 阶段只作用于**已加载**窗口（懒加载下只有这些有数据），并给一个
  「加载全部以筛选」按钮，由用户显式承担全量成本。
- **兼容**：`parseIndex` 容忍旧 v1 索引（无摘要）——那种条目回退为「读该会话文件取计数」。

文件：`opencode-plugin/index.js`（`summarize` / `titleFor` + 索引 v2）、`src/doc.js`（`parseIndex`）、
`src/board.js`（窗口化 / 置顶 / 懒读）、`board/index.html`（置顶卡 / 哨兵样式）、`scripts/test-index.mjs`（新）、
`scripts/test-plugin.mjs`（`summarize` 用例）。版本 `0.7.1 → 0.8.0`。

验证：`bun run test` 全绿；`design/verify-pages.html`（20 会话、带摘要索引、当前会话 = `ses_phased`）：
首屏 `pinned=1 cards=16 sentinel=yes divider="已显示 15 / 19"`，滚到底后 `cards=20 sentinel=no endnote=yes`。
