# 会话归档（看板）— 设计规格

> 状态：已确认，进入实现。经用户确认的三项决策：**动作落在"会话卡片级"**、**归档状态属扩展本地
> （`host.storage`），不写回镜像**、**默认不加载不渲染 + 「继续会话有新 todowrite 自动浮出」+
> 「批量归档已完成」**。后续增量：**自动收拢已完成会话**（`archive:prefs` 开关，默认开）与
> **当前会话可手动归档**（见 §4 / §6）。

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

偏好单键（与归档文档分开，避免 `parseArchive` 为新增字段做迁移）：

```
key = "archive:prefs"
value = { version: 1, auto: <布尔：自动收拢开/关> }
```

- `auto` 缺省或缺值/坏值为**真**（默认开）。只有显式 `false` 才关。

## 5. 模块与文件

| 文件 | 职责 |
| --- | --- |
| `src/archive.js`（新增） | 纯逻辑：`parseArchive` / `parsePrefs` / `isArchived` / `partition` / `isFullyFinished` / `finishedSessionIDs` / `autoArchiveIDs` / `withArchived` / `withoutArchived`；常量 `ARCHIVE_KEY` / `PREFS_KEY`。无 DOM、无 SDK。 |
| `scripts/test-archive.mjs`（新增） | 上述纯函数的 Node 单测（沿用 `scripts/test-index.mjs` 的 `check` 风格）。 |
| `src/board.js`（改） | 读 `host.storage`、分区、折叠区渲染、归档/恢复/批量/撤销、自动收拢（`refresh` 内静默 sweep）、偏好读写、扩展 sentinel observer。 |
| `board/index.html`（改） | 工具栏加 `#archiveHost`、`#autoArchiveHost`；归档按钮 / 折叠 / 撤销条 / 自动开关的样式。 |
| `package.json`（改） | `test` 脚本追加 `node scripts/test-archive.mjs`。 |
| `design/verify-pages.html`（改） | 协议桩补答 `storage`，并加归档探针，便于不装 OpenChamber 验证。 |

## 6. 看板行为

- `refresh()` 并行读 `_index.json` 与 `host.storage.get("archive")`；`partition` 后：`agenda` = 活动、
  `archived` = 收起。`metaOf` 改为在全部 meta（含归档）里查。
- 汇总条、会话下拉、`windowMetas()` 只含活动会话 → 归档默认**不读镜像、不渲染**。
- `windowMetas()` 仅在 `showArchived` 为真时并入 `archived.slice(0, archivedLoadedCount)`——
  点开折叠才加载镜像。
- 卡片头部：活动卡片有「归档」，折叠区内的卡片有「恢复」；置顶的「当前会话」卡未归档时有「归档」、已归档时有「恢复」（与其它卡片一致，故当前会话也可手动归档；归档后仍置顶显示、可一键恢复，离开该会话后才进折叠区）。
- 折叠行「🗄 已归档 N 个会话 · M 项」默认收起，点开加 `.open` 并惰性渲染；折叠区内还有
  `#archivedSentinel` 分批加载与「全部恢复」。
- 动作写入 `host.storage` 后本地 `refresh`，并弹 toast；同时出现 8 秒「撤销」条（`host.toast` 不支持
  回调按钮，故撤销走看板内的条）。
- 会话下拉过滤到某会话而该会话被归档时，`filter.session` 复位为 `all`；但**当前会话除外**——单看当前会话时即使它被归档也保持视图，不踢回全部。
- **自动收拢**：`refresh()` 每轮（4s）读 `archive:prefs`；若 `auto` 为真且本轮 `archive` 读成功（`readOk`），用纯函数 `autoArchiveIDs(metas, archive, { keep, hold, now, readOk })` 取应归档 id；非空则**再读一次** `archive` 合并（免覆盖在途的手动写）后 `set` 一次，**无 toast、不记撤销**。`keep` = 当前会话 + 下拉过滤目标；`hold` = 刚被恢复/撤销的 id（其 `updatedAt` 越过记录时刻前不收）；`updatedAt > now`（时钟回拨）跳过。写失败后置 `sweepPaused` 停收，避免每 4s 静默重试。
- 工具栏新增 `#autoArchiveHost` 复选框「自动归档已完成」，默认开；改动写 `archive:prefs`，失败 toast。

## 7. 失败与降级

- `host.storage.get` 抛错或未答：`parseArchive` 归空 → 无归档，其余照常；同时 `readOk=false`，自动收拢本轮**跳过**，绝不拿空归档去 `set` 覆盖服务端已有文档。
- `host.storage.set` 抛错：回滚内存值、清撤销条、toast 报错；自动收拢的 `set` 抛错则置 `sweepPaused`，本轮起停收（如整份文档超 64 KiB）。
- `archive:prefs` 读失败或缺失：沿用内存默认（开）。
- 旧 v1 索引（无 summary）：`isFullyFinished` 返回 false，批量归档与自动收拢**都不猜**，该会话不被收起。

## 8. 测试与验证

- `node scripts/test-archive.mjs`：parse 防御、`isArchived` 边界（等于/越过/无条目）、partition 顺序
  与 `keepActiveID`、`isFullyFinished` 口径、批量选择、纯编辑不 mutate；另加 `parsePrefs` 默认/坏值、
  `autoArchiveIDs` 的 `readOk`/`keep`/`hold`/`now`/已归档/无 summary/不 mutate 各守卫。
- `design/verify-pages.html`：桩答 `storage`；探针点「批量归档已完成」→ 断言卡片移出、折叠出现 →
  展开 → 断言归档卡与「恢复」→ 恢复 → 断言折叠消失。另加自动收拢探针：清空桩存储并重载看板，
  断言已完成会话**未经点击**即被收起、折叠出现，且改开关后 `archive:prefs` 落盘。
- `~/.bun/bin/bun run build`（重建 `board/main.js`）、`validate`、`test`。

## 9. 发布

按仓库习惯升 minor：`0.8.0 → 0.9.0`（`package.json` + `opencode-plugin/package.json`），构建并提交
`board/main.js`。**本次不自动提交**（见实施计划尾注）。自动收拢（`archive:prefs` + `autoArchiveIDs`）
是随后的增量，版本号待发版时再定。
