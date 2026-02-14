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
  - Supports `statusTitleLabel` to choose which label value(s) are appended.
  - `statusTitleLabel` accepts multiple labels via repeated labels or delimited value (`comma`, `;`, `|`, newline).
- `apps/client/src/components/note_context.ts`
  - Applies status-appended title logic to note context title display.

## Deprecated script note

- Note `M4GVmVlM1oY4` (`Tree Short Title + Tooltip (JS Frontend) ✔️`) is deprecated.
- Keep it for historical reference only.
- Do not run it (`#run=frontendStartup` must remain absent), because it rewrites tree DOM text and conflicts with core status suffix rendering.

## JSON Authoring MVP (Trilium note-driven runtime)

Runtime notes:

- UI shell: `NY903UTDSAGD` (`json authoring mvp html`)
- Runtime JS: `VNkUo2Se8J6e` (`json authoring mvp js`)
- Config: `xAEs1WrfPCIp` (`MVP Dataset Config`)
- Target dataset: `4jDHmkMm5INE` (`dropdown options`)
- Demo host: `Xioshh9UFMD9` (`JSON Authoring MVP Demo`)

Current behavior:

- Main grid validates before save and blocks invalid writes.
- Subgrid and nested subgrid validate before save and block invalid writes.
- Validation failures are shown in a modal summary and as inline per-cell errors in subgrids.
- Numeric editors use text input with numeric input mode so invalid numeric text is preserved and validated (not silently sanitized by browser number input behavior).

Operational prerequisites:

- Runtime JS note must run as frontend startup.
- If bridge errors occur (`JSON authoring bridge unavailable`), verify startup run labels and reload.

Troubleshooting:

- If focus becomes unstable in modal editors, check recent modal event handling changes in `VNkUo2Se8J6e`.
- If a validation rule appears ignored, verify `optionsSource` resolution and `validation.allowedValues` in `xAEs1WrfPCIp`.
