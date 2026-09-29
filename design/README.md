# Design notes

Reference material for the Work Status section. Not shipped to OpenChamber.

![Rendered section](preview.jpg)

Rendered from the real `status/index.html` + `status/main.js`, driven by a stub
of the host protocol. Left: default. Middle: finished items expanded. Bottom:
dark theme.

## The problem with the first version

The section worked but looked like a terminal:

- ASCII marks (`[x]`, `[ ]`, `[•]`) instead of a checkbox, so it did not read as
  part of the app, whose own controls use a 14px/4px-border-radius box.
- A plain `Todo [7/8]` heading with no visual progress.
- Priority as right-aligned uppercase text, competing with the task text.
- Finished and open items interleaved, so a long tail of done work pushed the
  active item out of a 200px section.
- Long task names reflowed at unpredictable heights.

## What it does now

| Change | Why |
| --- | --- |
| Real checkbox (13px, 4px radius, CSS-drawn tick) | Matches `.oc-sdk-check-box`; no icon font the sandboxed frame cannot load |
| 2px progress bar under the count | Progress is visible without reading numbers |
| Work in progress pinned to the top | The open item is what the reader wants first |
| Finished items collapse into `已完成 N 项` | Spends the 200px on open work; expands on click, and the choice survives re-renders |
| Priority as a rising mark: `⌃⌃` / `⌃` / `·` | Visible at a glance, does not compete with the text |
| Long text wraps; row height stays predictable | |

## Priority marks

Two chevrons for the top level, one for the next, a dot for ordinary work.

| Mark | Priority | Colour |
| --- | --- | --- |
| `⌃⌃` | high | purple — `#5e409d` light, `#8b7ec8` dark |
| `⌃` | medium | blue — `#205ea6` light, `#4385be` dark |
| `·` | low | muted (host `--oc-muted`) |

Characters, not CSS-drawn shapes. A first attempt rotated a 5px box into a
chevron; its ink is about 7px tall, so stacking two either overflowed the 17px
line or fused into one blob. `U+2303` brings its own metrics and stacks cleanly
with `letter-spacing: -1px`.

The mark shares the task text's line box (`line-height` matched to the body), so
it rides the same baseline. An independent line-height pushed it to the row top.

The host palette has no purple, so the two priority colours are defined here.
`applyHostReady` sets `data-oc-theme` on the root, which selects the dark
variant; the `:root` values are the light ones and double as the pre-theme
fallback. Both are Flexoki, the palette the app uses.


## Colours

Everything comes from the host's `--oc-*` variables, applied by `applyHostReady`.
The names used are the ones the SDK actually defines — `--oc-fg`, `--oc-muted`,
`--oc-border`, `--oc-primary`, `--oc-success`, `--oc-warning`, `--oc-error`,
`--oc-hover`, `--oc-font`.

An earlier revision used `--oc-text`, which does not exist; the colour then fell
back to a hardcoded light-theme grey and went nearly invisible in dark mode.
Inline fallbacks in `status/index.html` now mirror the light theme so the first
paint is readable before the theme lands.

## Files here

- `preview.html` — three candidate layouts side by side, light and dark. The
  chosen one is **A · Checklist**.
- `verify.html` — renders the real shipped page against a protocol stub at 2×, so
  a change to `status/` or `src/` can be checked without installing it.
- `preview.jpg` — the screenshot above.

## Checking a change

```bash
bun run build
python3 -m http.server 8899    # from the repo root
# open http://127.0.0.1:8899/design/verify.html
```

`verify.html` speaks the same wire protocol the app does: channel
`openchamber.sdk`, `v: 1`, `type: "ready"` pushed to the frame, `type:
"file-read"` answered with `{ content }`.
