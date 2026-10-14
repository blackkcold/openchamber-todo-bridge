# 会话归档（看板）— 设计规格

> 状态：已确认，进入实现。经用户确认的三项决策：**动作落在"会话卡片级"**、**归档状态属扩展本地
> （`host.storage`），不写回镜像**、**默认不加载不渲染 + 「继续会话有新 todowrite 自动浮出」+
> 「批量归档已完成」**。

## 1. 目标与意图

看板的「最近会话」会堆积一些**已经没有后续会话**的旧 todo。读者想一键把它们收起来，别占着列表。

- 在**会话卡片级**提供「归档」：一点，整张卡片移出「最近会话」，收进列表末尾的「🗄 已归档」折叠区。
- 提供一个**批量归档**按钮，默认作用域 = **所有"任务已全部完成"的会话**（无未完成工作）。归档后同样
  默认不显示在 list 中。
- 归档是**可逆**的：卡片有「恢复」，折叠区有「全部恢复」，动作后有「撤销」条。
- 归档会话**默认不加载镜像、不渲染**（性能）；**若该会话继续并产生新的 `todowrite`，自动回到列表**。

## 2. 非目标

- 不改 OpenCode 本体、不改插件、不改镜像文件 `<sessionID>.json`、不改 `_index.json`。
- 不改 manifest / 授权（`host.storage` 无需能力）。
- 不改 rail 面板与 Work Status 区（那是单会话/当前会话面，保持只读）。
- 不做服务端/多用户同步；不做跨服务器共享归档。

## 3. 关键约束（已核实）

- 看板页面**原本刻意只读**：`src/board.js` 顶部与 README 都写明"never writes the list back"，因为写回
  镜像会与**活会话**的插件整表重写打架。归档功能因此**不碰镜像**。
- 扩展具备 `host.storage`（服务端 KV，无需能力，值 ≤64 KiB，命名空间 ≤2 MiB / ≤2000 键）；`src/` 里
  `plugin-install.js` 已在使用 `host.writeFile`，说明写能力在场，但本设计不用它。
- 插件 `writeIndex()` 会把 `todos/` 目录里**除 `_index.json` 外的任意 `.json` 当会话镜像**，所以归档
  状态**不能**落在该目录的文件里（会冒出一张假卡片）——这也是选择 `host.storage` 的原因之一。
- 插件每次 `todowrite` 都会重写 `_index.json`，对应会话的 `updatedAt` 前移——这是"自动浮出"判据的
  依据。

## 4. 数据模型

单键 `host.storage`：

```
key = "archive"
value = { version: 1, sessions: { "<sessionID>": <归档时刻 epochMs> } }
```

- **判定**：`isArchived = 归档时刻 >= meta.updatedAt`。归档只保证"在它最后一次更新之后被收起"；
  一旦该会话再次 `todowrite`，`updatedAt` 越过归档时刻，判定翻转为**未归档**，会话自动回到列表。
  纯计算，**无需改写存储**；陈旧条目只可能藏住一个"自被收起以来没动过"的会话。
- **`keepActiveID`**：当前会话（看板 `currentID`）永不判为归档，避免把自己正开着的会话藏起来，也避免
  同一会话同时出现在两处。
- 无清理：陈旧条目无害。命名空间远大于实际用量；卸载扩展时随该命名空间一并清空（文档注明）。

## 5. 模块与文件

| 文件 | 职责 |
| --- | --- |
| `src/archive.js`（新增） | 纯逻辑：`parseArchive` / `isArchived` / `partition` / `isFullyFinished` / `finishedSessionIDs` / `withArchived` / `withoutArchived`。无 DOM、无 SDK。 |
| `scripts/test-archive.mjs`（新增） | 上述纯函数的 Node 单测（沿用 `scripts/test-index.mjs` 的 `check` 风格）。 |
| `src/board.js`（改） | 读 `host.storage`、分区、折叠区渲染、归档/恢复/批量/撤销、扩展 sentinel observer。 |
| `board/index.html`（改） | 工具栏加 `#archiveHost`；归档按钮 / 折叠 / 撤销条的样式。 |
| `package.json`（改） | `test` 脚本追加 `node scripts/test-archive.mjs`。 |
| `design/verify-pages.html`（改） | 协议桩补答 `storage`，并加归档探针，便于不装 OpenChamber 验证。 |

## 6. 看板行为

- `refresh()` 并行读 `_index.json` 与 `host.storage.get("archive")`；`partition` 后：`agenda` = 活动、
  `archived` = 收起。`metaOf` 改为在全部 meta（含归档）里查。
- 汇总条、会话下拉、`windowMetas()` 只含活动会话 → 归档默认**不读镜像、不渲染**。
- `windowMetas()` 仅在 `showArchived` 为真时并入 `archived.slice(0, archivedLoadedCount)`——
  点开折叠才加载镜像。
- 卡片头部：活动卡片有「归档」，折叠区内的卡片有「恢复」；置顶的「当前会话」卡两者皆无。
- 折叠行「🗄 已归档 N 个会话 · M 项」默认收起，点开加 `.open` 并惰性渲染；折叠区内还有
  `#archivedSentinel` 分批加载与「全部恢复」。
- 动作写入 `host.storage` 后本地 `refresh`，并弹 toast；同时出现 8 秒「撤销」条（`host.toast` 不支持
  回调按钮，故撤销走看板内的条）。
- 会话下拉过滤到某会话而该会话被归档时，`filter.session` 复位为 `all`。

## 7. 失败与降级

- `host.storage.get` 抛错或未答：`parseArchive` 归空 → 无归档，其余照常。
- `host.storage.set` 抛错：回滚内存值、清撤销条、toast 报错。
- 旧 v1 索引（无 summary）：`isFullyFinished` 返回 false，批量归档**不猜**，该会话不被批量收起。

## 8. 测试与验证

- `node scripts/test-archive.mjs`：parse 防御、`isArchived` 边界（等于/越过/无条目）、partition 顺序
  与 `keepActiveID`、`isFullyFinished` 口径、批量选择、纯编辑不 mutate。
- `design/verify-pages.html`：桩答 `storage`；探针点「批量归档已完成」→ 断言卡片移出、折叠出现 →
  展开 → 断言归档卡与「恢复」→ 恢复 → 断言折叠消失。
- `~/.bun/bin/bun run build`（重建 `board/main.js`）、`validate`、`test`。

## 9. 发布

按仓库习惯升 minor：`0.8.0 → 0.9.0`（`package.json` + `opencode-plugin/package.json`），构建并提交
`board/main.js`。**本次不自动提交**（见实施计划尾注）。
