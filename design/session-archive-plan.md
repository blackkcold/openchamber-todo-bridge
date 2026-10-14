# Session Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the task board set a session aside ("archive") so dead sessions leave the list, reversibly and without writing any todo data.

**Architecture:** Archive state lives in the extension's own `host.storage` under one key, never in a mirror or `_index.json`. A pure module (`src/archive.js`) decides what is archived by comparing a stored timestamp against the session's index `updatedAt`; the board reads that state, splits the session list, and renders the set-aside ones behind a lazily-loaded fold.

**Tech Stack:** Bun (`Bun.build`, IIFE output), `@openchamber/sdk` (`connectHost`, `host.storage`, `@openchamber/sdk/ui`), Node `.mjs` pure tests.

**Spec:** `design/session-archive-design.md`

## Global Constraints

- UI copy is Chinese; match existing board strings exactly.
- `src/archive.js` is pure: no DOM, no SDK, no host imports.
- The board must not write to `~/.config/openchamber/todos/*.json` or `_index.json`.
- Storage shape is `{ version: 1, sessions: { "<sessionID>": <epochMs> } }`, key `"archive"`.
- Archived sessions are not read and not rendered until the fold is opened.
- bun is at `~/.bun/bin/bun` (not on PATH); invoke it by absolute path.

## Review Focus

- **A live session archived then resumed** — a `todowrite` bumps `_index.json` `updatedAt`; the session must reappear in the list without any manual step and without a stale entry hiding it.
- **A v1 index (no summary fields)** — bulk archive must skip such a session rather than archive it on a guess.
- **The session currently open** — never archived (single click or bulk), never shown twice.
- **A host that refuses or does not answer `storage`** — the board still renders; archiving degrades to a no-op with a toast, never a blank page.
- **Every session archived** — the list shows a fitting empty note and the fold is still reachable, so nothing becomes unrecoverable.

---

### Task 1: Pure archive module

**Files:**
- Create: `src/archive.js`
- Test: `scripts/test-archive.mjs`

**Interfaces:**
- Produces: `ARCHIVE_KEY = "archive"`; `emptyArchive() -> { version, sessions }`; `parseArchive(raw) -> { version, sessions }`; `isArchived(entry, meta) -> boolean`; `partition(metas, entry, keepActiveID) -> { active, archived }`; `isFullyFinished(meta) -> boolean`; `finishedSessionIDs(metas, entry, keepActiveID) -> string[]`; `withArchived(entry, ids, now) -> entry`; `withoutArchived(entry, ids) -> entry`. A `meta` is `{ sessionID, updatedAt, total?, doing?, pending? }` (from `src/doc.js#parseIndex`).

- [ ] **Step 1: Write the failing test** — `scripts/test-archive.mjs` covering: `parseArchive` on `undefined`/string/array/`{sessions:{a:5}}`/non-numeric stamp/empty id; `isArchived` for no entry, `stamp>=updatedAt`, `stamp<updatedAt`, other-id; `partition` order and `keepActiveID`; `isFullyFinished` for all-done / doing / pending / total 0 / no summary; `finishedSessionIDs` skipping already-archived, the in-view id, and picking finished; `withArchived`/`withoutArchived` not mutating input. Use the `check(name, pass)` + `process.exit(1)` shape from `scripts/test-index.mjs`.
- [ ] **Step 2: Run test, verify it fails** — `node scripts/test-archive.mjs` → fails: `src/archive.js` missing.
- [ ] **Step 3: Implement `src/archive.js`** — the functions above. `isArchived` returns `at >= (updatedAt || 0)`; `isFullyFinished` returns `total>0 && doing===0 && pending===0`; `withArchived`/`withoutArchived` clone `sessions`.
- [ ] **Step 4: Run test, verify it passes** — `node scripts/test-archive.mjs` → all checks passed.
- [ ] **Step 5: Wire into the suite** — add `&& node scripts/test-archive.mjs` to the `test` script in `package.json`; run `node scripts/test-archive.mjs` once more to confirm.

### Task 2: Board rendering and actions

**Files:**
- Modify: `board/index.html` (toolbar `#archiveHost` + styles), `src/board.js`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: board UI — bulk button, per-card 「归档」/「恢复」, `#archiveToggle` fold, `#archivedSentinel`, `#restoreAll`, `#undoBar` with `#undoBtn`/`#undoDismiss`.

- [ ] **Step 1: `board/index.html`** — add `<div id="archiveHost"></div>` in `#toolbar` before `#legend`; add CSS for `.sess-act`, `.sess.archived`, `.archive`, `.arch-fold`, `.undo-bar`.
- [ ] **Step 2: `src/board.js` state + imports** — import the Task 1 names; add `allMetas`, `archived`, `archive = emptyArchive()`, `showArchived = false`, `archivedLoadedCount = BATCH`, `undo`, `undoTimer`, `observers`.
- [ ] **Step 3: partition in `refresh()`** — read `host.storage.get(ARCHIVE_KEY)` (catch → `undefined`); `allMetas = metas`; `archive = parseArchive(raw)`; `const { active, archived } = partition(metas, archive, currentID)`; include `archive`/`showArchived`/`archivedLoadedCount` in `lastKey`; reset `filter.session` when its target is now archived.
- [ ] **Step 4: `metaOf` over `allMetas`; `windowMetas` adds archived when `showArchived`.**
- [ ] **Step 5: card header/card** — `sessionHeader(meta, { archive, restore })` renders `data-archive` / `data-restore`; `sessionCard(meta, current, archivedCard)` passes the right option and adds `.sess.archived`.
- [ ] **Step 6: `paint()`** — render `undoBarHtml() + main + archivedSectionHtml()`; `archivedSectionHtml()` shows the fold (count only from index) and, when open, `archived.slice(0, archivedLoadedCount)` cards plus `#archivedSentinel` (or endnote) and `#restoreAll`; `undoBarHtml()` renders label + `#undoBtn` + `#undoDismiss`.
- [ ] **Step 7: actions** — `commitArchive(entry, previous, label, successMessage)` (set `archive`, `armUndo`, `host.storage.set` with rollback+toast on error, `lastKey=""`, `refresh`, success toast); `archiveSession`, `restoreSession`, `archiveFinished` (via `finishedSessionIDs(allMetas, archive, currentID)`), `restoreAllArchived`, `performUndo`, `armUndo` (9s), `clearUndo`, `toggleArchived`, `loadMoreArchived`.
- [ ] **Step 8: observers** — replace the single `observer` with `observers[]` + `disconnectObservers()` + `attachObserver(node, onHit)`; `observeSentinel()` wires `#sentinel`→`loadMore`, `#archivedSentinel`→`loadMoreArchived`, `#loadAll`.
- [ ] **Step 9: toolbar + delegation** — `mountButton(el("archiveHost"), { label: "批量归档已完成", variant: "secondary", size: "sm", onClick: () => void archiveFinished() })`; extend the `#sessions` click handler for `#archiveToggle`, `#restoreAll`, `#undoBtn`, `#undoDismiss`, `[data-archive]`, `[data-restore]`.
- [ ] **Step 10: Build + test** — `~/.bun/bin/bun run build` (rebuilds `board/main.js`), `~/.bun/bin/bun run test`, `~/.bun/bin/bun run validate`; all pass.

### Task 3: Verify without OpenChamber

**Files:**
- Modify: `design/verify-pages.html`

- [ ] **Step 1: answer `storage`** — add an in-memory `STORE` and a `msg.type === "storage"` branch returning `{ storage: true, op, found, value? }` / `{ storage: true, op: "set" }` before the catch-all.
- [ ] **Step 2: archive probe** — after the existing probes, click `#archiveHost button`, assert cards leave and the fold appears, expand it, assert an archived card with a `data-restore` button, click restore, assert the fold is gone. Log to `#log`.
- [ ] **Step 3: check in a browser** — serve the repo (`~/.bun/bin/bun run build` then `python3 -m http.server` from the repo root) and open `/design/verify-pages.html`; confirm the log lines and, visually, the fold and buttons.

### Task 4: Version bump

**Files:**
- Modify: `package.json`, `opencode-plugin/package.json`

- [ ] **Step 1: bump minor 0.8.0 → 0.9.0** in both files.
- [ ] **Step 2: rebuild + validate** — `~/.bun/bin/bun run build`, `~/.bun/bin/bun run validate` → manifest valid.

---

**Tail note:** Do not commit or tag. Per project rules, commits happen only on explicit request; the release steps (bump, build, merge `main`, tag, GitHub Release) are in `README.md` and run when the user asks.
