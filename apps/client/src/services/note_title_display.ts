import type FNote from "../entities/fnote.js";

const STATUS_LABEL = "status";
const STATUS_IN_TITLE_LABEL = "statusInTitle";
const STATUS_TITLE_LABEL_NAME = "statusTitleLabel";

const TRUE_VALUES = new Set([ "1", "true", "yes", "y", "on", "enabled", "enable", "active", "☑️" ]);
const FALSE_VALUES = new Set([ "0", "false", "no", "n", "off", "disabled", "disable", "inactive", "❌", "✝️" ]);

export interface StatusTitleConfig {
    enabled?: boolean;
    labelName?: string;
    labelNames?: string[];
}

function parseBooleanLabelValue(value: string | null | undefined, hasLabel: boolean): boolean {
    if (value === undefined || value === null || value.trim() === "") {
        return hasLabel;
    }

    const normalized = normalizeRawValue(value).toLowerCase();

    if (TRUE_VALUES.has(normalized)) {
        return true;
    }

    if (FALSE_VALUES.has(normalized)) {
        return false;
    }

    return false;
}

function getEffectiveLabel(note: FNote, labelName: string, visited = new Set<string>()): { exists: boolean; value: string | null } {
    if (visited.has(note.noteId)) {
        return { exists: false, value: null };
    }

    visited.add(note.noteId);

    const ownLabel = note.getOwnedLabel(labelName);
    if (ownLabel) {
        return { exists: true, value: ownLabel.value ?? "" };
    }

    for (const parent of note.getParentNotes()) {
        if (parent.type === "search") {
            continue;
        }

        const fromParent = getEffectiveLabel(parent, labelName, visited);
        if (fromParent.exists) {
            return fromParent;
        }
    }

    return { exists: false, value: null };
}

function getStatusLabelName(note: FNote): string {
    const configured = getEffectiveLabel(note, STATUS_TITLE_LABEL_NAME);
    if (!configured.exists || configured.value === null) {
        return STATUS_LABEL;
    }

    const trimmed = normalizeRawValue(configured.value).replace(/^#/, "");
    return trimmed.length > 0 ? trimmed : STATUS_LABEL;
}

function getStatusValue(note: FNote): string | null {
    const labelName = getStatusLabelName(note);
    const status = getEffectiveLabel(note, labelName);
    if (!status.exists || status.value === null) {
        return null;
    }

    const trimmed = normalizeRawValue(status.value);
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeRawValue(raw: string): string {
    const trimmed = raw.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith("`") && trimmed.endsWith("`"))
    ) {
        return trimmed.slice(1, -1).trim();
    }

    return trimmed;
}

export function shouldAppendStatusToTitle(note: FNote): boolean {
    const resolved = getEffectiveLabel(note, STATUS_IN_TITLE_LABEL);
    const hasLabel = resolved.exists;
    const value = resolved.value;

    return parseBooleanLabelValue(value, hasLabel);
}

export function getTitleWithStatus(note: FNote, baseTitle: string): string {
    return getTitleWithStatusConfigurable(note, baseTitle);
}

export function getTitleWithStatusConfigurable(note: FNote, baseTitle: string, config?: StatusTitleConfig): string {
    const enabled = config?.enabled ?? shouldAppendStatusToTitle(note);
    if (!enabled) {
        return baseTitle;
    }

    const configuredLabelNames = (config?.labelNames && config.labelNames.length > 0)
        ? config.labelNames
        : (config?.labelName ? [ config.labelName ] : []);

    const statuses = configuredLabelNames.length > 0
        ? configuredLabelNames
            .map(labelName => note.getLabelValue(labelName))
            .map(status => (status ? normalizeRawValue(status) : ""))
            .filter(status => status.length > 0)
        : [];

    const status = statuses.length > 0
        ? statuses.join(" ")
        : getStatusValue(note);

    if (!status) {
        return baseTitle;
    }

    return `${baseTitle} — ${status}`;
}

export function isTruthyLabelValue(value: string | null | undefined, hasLabel = true): boolean {
    return parseBooleanLabelValue(value, hasLabel);
}

export function normalizeLabelValue(raw: string): string {
    return normalizeRawValue(raw);
}
