# Bryson Dev Workflow

## Core overrides

These customisations are implemented in core client code (not frontend startup scripts):

- `apps/client/src/widgets/note_tree.ts`
  - Uses `treeShortTitle` for left-tree display.
  - Uses `treeTooltip` for hover tooltip text.
  - Appends status suffix to tree titles when enabled.
- `apps/client/src/services/note_title_display.ts`
  - Shared status-title logic.
  - Supports `statusInTitle` toggle label.
  - Supports `statusTitleLabel` to choose which label value is appended.
- `apps/client/src/components/note_context.ts`
  - Applies status-appended title logic to note context title display.

## Deprecated script note

- Note `M4GVmVlM1oY4` (`Tree Short Title + Tooltip (JS Frontend) ✔️`) is deprecated.
- Keep it for historical reference only.
- Do not run it (`#run=frontendStartup` must remain absent), because it rewrites tree DOM text and conflicts with core status suffix rendering.
