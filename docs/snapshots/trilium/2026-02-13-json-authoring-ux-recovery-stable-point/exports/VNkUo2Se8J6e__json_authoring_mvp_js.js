(function () {
    function isNonEmptyString(v) {
        return typeof v === 'string' && v.trim().length > 0;
    }

    function isTruthyLabelValue(v) {
        if (v === true) return true;
        if (typeof v !== 'string') return false;
        const n = v.trim().toLowerCase();
        return n === 'true' || n === '1' || n === 'yes' || n === 'on';
    }

    function apiBase() {
        const base = window.glob && window.glob.baseApiUrl ? window.glob.baseApiUrl : 'api/';
        return '/' + String(base).replace(/^\/+|\/+$/g, '');
    }

    async function fetchNoteText(noteId) {
        const res = await fetch(apiBase() + '/notes/download/' + encodeURIComponent(noteId), {
            credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('Failed to load note ' + noteId + ': HTTP ' + res.status);
        return await res.text();
    }

    function deepClone(v) {
        return JSON.parse(JSON.stringify(v));
    }

    function getByPath(obj, path) {
        const parts = String(path || '').split('.').filter(Boolean);
        let cur = obj;
        for (const p of parts) {
            if (cur == null || typeof cur !== 'object') return undefined;
            cur = cur[p];
        }
        return cur;
    }

    function setByPath(obj, path, value) {
        const parts = String(path || '').split('.').filter(Boolean);
        if (!parts.length) return;
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = value;
    }

    function defaultValueForType(type) {
        if (type === 'number') return 0;
        if (type === 'boolean') return false;
        if (type === 'string|null') return null;
        if (type === 'json') return {};
        if (type === 'json-array') return [];
        return '';
    }

    function parseTypeValue(raw, type) {
        if (type === 'number') {
            const n = Number(raw);
            return Number.isFinite(n) ? n : raw;
        }
        if (type === 'boolean') {
            if (raw === true || raw === 'true' || raw === 'TRUE' || raw === '1') return true;
            if (raw === false || raw === 'false' || raw === 'FALSE' || raw === '0') return false;
            return raw;
        }
        if (type === 'string|null') {
            if (raw === '' || raw === null || typeof raw === 'undefined') return null;
            return String(raw);
        }
        if (type === 'json-array') {
            if (raw === '' || raw === null || typeof raw === 'undefined') return [];
            if (Array.isArray(raw)) return raw;
            if (typeof raw === 'string') {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed === null || typeof parsed === 'undefined') return [];
                    return parsed;
                } catch {
                    return raw;
                }
            }
            return raw;
        }
        if (type === 'json') {
            if (raw === '' || raw === null || typeof raw === 'undefined') return null;
            if (typeof raw === 'string') {
                try {
                    return JSON.parse(raw);
                } catch {
                    return raw;
                }
            }
            return raw;
        }
        return raw == null ? '' : String(raw);
    }

    function typeValid(value, type) {
        if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
        if (type === 'boolean') return typeof value === 'boolean';
        if (type === 'string') return typeof value === 'string';
        if (type === 'string|null') return value === null || typeof value === 'string';
        if (type === 'json') return value === null || (typeof value === 'object' && value !== undefined);
        if (type === 'json-array') return value === null || Array.isArray(value);
        return true;
    }

    function getValidationConfig(col) {
        if (!col || typeof col !== 'object') return {};
        if (!col.validation || typeof col.validation !== 'object') return {};
        return col.validation;
    }

    function getRuleMessage(col, ruleKey, fallback) {
        const cfg = getValidationConfig(col);
        const messages = cfg.messages && typeof cfg.messages === 'object' ? cfg.messages : null;
        const msg = messages ? messages[ruleKey] : null;
        return isNonEmptyString(msg) ? msg : fallback;
    }

    function getAllowedValues(col) {
        const cfg = getValidationConfig(col);
        if (Array.isArray(cfg.allowedValues)) {
            return cfg.allowedValues.map(function (v) { return String(v); });
        }
        if (Array.isArray(col.options)) {
            return col.options
                .map(function (opt) {
                    if (opt && typeof opt === 'object' && !Array.isArray(opt)) return opt.value;
                    return opt;
                })
                .filter(function (v) { return v !== null && typeof v !== 'undefined'; })
                .map(function (v) { return String(v); });
        }
        return [];
    }

    function resolveBridge() {
        if (window.jsonAuthoringBridge && window.jsonAuthoringBridge.saveContent) return window.jsonAuthoringBridge;

        if (typeof api === 'undefined' || !api.runOnBackend) return null;

        window.jsonAuthoringBridge = {
            saveContent: async function (targetNoteId, textContent) {
                return await api.runOnBackend(function (backendTargetNoteId, backendContent) {
                    const note = api.getNote(backendTargetNoteId);
                    if (!note) throw new Error('Target note not found: ' + backendTargetNoteId);

                    if (typeof note.setContent === 'function') {
                        note.setContent(backendContent);
                        return true;
                    }

                    if ('content' in note) {
                        note.content = backendContent;
                        if (typeof note.save === 'function') note.save();
                        return true;
                    }

                    throw new Error('No supported content write method on note object.');
                }, [targetNoteId, textContent]);
            },
            createRevision: async function (targetNoteId) {
                return await api.runOnBackend(function (backendTargetNoteId) {
                    const note = api.getNote(backendTargetNoteId);
                    if (!note) throw new Error('Target note not found: ' + backendTargetNoteId);
                    if (typeof note.saveRevision === 'function') {
                        note.saveRevision();
                        return 'saveRevision';
                    }
                    if (typeof note.createRevision === 'function') {
                        note.createRevision();
                        return 'createRevision';
                    }
                    if (typeof note.getNewRevision === 'function') {
                        note.getNewRevision();
                        return 'getNewRevision';
                    }
                    return null;
                }, [targetNoteId]);
            },
            saveAsChildJson: async function (parentNoteId, title, content) {
                return await api.runOnBackend(function (backendParentNoteId, backendTitle, backendContent) {
                    const parent = api.getNote(backendParentNoteId);
                    if (!parent) throw new Error('Parent note not found: ' + backendParentNoteId);

                    let child = null;

                    if (typeof parent.createCodeNote === 'function') {
                        child = parent.createCodeNote(backendTitle, backendContent, 'application/json');
                    }

                    if (!child && typeof parent.createTextNote === 'function') {
                        child = parent.createTextNote(backendTitle, backendContent);
                        if (child && typeof child.setLabel === 'function') child.setLabel('mime', 'application/json');
                    }

                    if (!child && typeof api.createNewNote === 'function') {
                        child = api.createNewNote({
                            parentNoteId: backendParentNoteId,
                            title: backendTitle,
                            type: 'code',
                            mime: 'application/json',
                            content: backendContent
                        });
                    }

                    if (!child) throw new Error('Unable to create child note.');

                    const childNote = child.note || child;
                    if (typeof childNote.setLabel === 'function') childNote.setLabel('jsonAuthoringSnapshot', 'true');
                    return childNote.noteId || null;
                }, [parentNoteId, title, content]);
            }
        };

        return window.jsonAuthoringBridge;
    }

    function isPathAllowed(path, allowedPrefixes) {
        if (!Array.isArray(allowedPrefixes) || allowedPrefixes.length === 0) return false;
        return allowedPrefixes.some(function (prefix) {
            return path === prefix || path.startsWith(prefix + '.');
        });
    }

    function collectNestedViolations(node, path, rules, output) {
        if (Array.isArray(node)) {
            if (!isPathAllowed(path, rules.allowArrayPaths)) {
                output.push({ path: path || '(root)', type: 'array' });
                return;
            }
            return;
        }

        if (!node || typeof node !== 'object') return;

        if (path && !isPathAllowed(path, rules.allowObjectPaths)) {
            output.push({ path: path, type: 'object' });
            return;
        }

        Object.keys(node).forEach(function (key) {
            const child = node[key];
            if (child && typeof child === 'object') {
                const childPath = path ? (path + '.' + key) : key;
                collectNestedViolations(child, childPath, rules, output);
            }
        });
    }

    function columnForPath(path, cols) {
        const sorted = cols.slice().sort(function (a, b) { return String(b.key).length - String(a.key).length; });
        for (const col of sorted) {
            if (path === col.key || path.startsWith(col.key + '.')) return col.key;
        }
        return cols.length ? cols[0].key : null;
    }

    
    function validateRowsDetailed(rows, config) {
        const errors = [];
        const cellErrors = new Map();
        const rowSummaryMap = new Map();
        const cols = Array.isArray(config.columns) ? config.columns : [];

        function markCell(rowIndex, colKey, message) {
            cellErrors.set(rowIndex + '|' + colKey, message);
        }

        function addIssue(rowIndex, colKey, message) {
            errors.push(message);
            markCell(rowIndex, colKey, message);
            if (!rowSummaryMap.has(rowIndex)) rowSummaryMap.set(rowIndex, new Set());
            rowSummaryMap.get(rowIndex).add(colKey);
        }

        rows.forEach(function (row, rowIndex) {
            cols.forEach(function (col) {
                const val = getByPath(row, col.key);
                const valCfg = getValidationConfig(col);

                if (col.required) {
                    const missing = val === null || typeof val === 'undefined' || (typeof val === 'string' && val.trim() === '');
                    if (missing) {
                        const msg = getRuleMessage(col, 'required', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' is required.");
                        addIssue(rowIndex, col.key, msg);
                        return;
                    }
                }

                if (val !== null && typeof val !== 'undefined' && !typeValid(val, col.type)) {
                    const msg = getRuleMessage(col, 'type', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' must be " + col.type + '.');
                    addIssue(rowIndex, col.key, msg);
                    return;
                }

                const isEmpty = val === null || typeof val === 'undefined' || (typeof val === 'string' && val.trim() === '');
                if (isEmpty) return;

                const allowedValues = getAllowedValues(col);
                if (allowedValues.length > 0 && !allowedValues.includes(String(val))) {
                    const msg = getRuleMessage(col, 'allowedValues', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' must be one of: " + allowedValues.join(', '));
                    addIssue(rowIndex, col.key, msg);
                }

                if (typeof valCfg.enumRequired === 'boolean' && valCfg.enumRequired === true && allowedValues.length > 0 && !allowedValues.includes(String(val))) {
                    const msg = getRuleMessage(col, 'enumRequired', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' requires a valid enum value.");
                    addIssue(rowIndex, col.key, msg);
                }

                if (col.type === 'number' && typeof val === 'number' && Number.isFinite(val)) {
                    if (typeof valCfg.min === 'number' && val < valCfg.min) {
                        const msg = getRuleMessage(col, 'min', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' must be >= " + valCfg.min + '.');
                        addIssue(rowIndex, col.key, msg);
                    }
                    if (typeof valCfg.max === 'number' && val > valCfg.max) {
                        const msg = getRuleMessage(col, 'max', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' must be <= " + valCfg.max + '.');
                        addIssue(rowIndex, col.key, msg);
                    }
                }

                if (col.type === 'string' || col.type === 'string|null') {
                    const s = String(val);
                    if (typeof valCfg.minLength === 'number' && s.length < valCfg.minLength) {
                        const msg = getRuleMessage(col, 'minLength', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' must be at least " + valCfg.minLength + ' characters.');
                        addIssue(rowIndex, col.key, msg);
                    }
                    if (typeof valCfg.maxLength === 'number' && s.length > valCfg.maxLength) {
                        const msg = getRuleMessage(col, 'maxLength', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' must be at most " + valCfg.maxLength + ' characters.');
                        addIssue(rowIndex, col.key, msg);
                    }
                    if (isNonEmptyString(valCfg.pattern)) {
                        try {
                            const rx = new RegExp(valCfg.pattern);
                            if (!rx.test(s)) {
                                const msg = getRuleMessage(col, 'pattern', 'Row ' + (rowIndex + 1) + ": '" + col.key + "' does not match required pattern.");
                                addIssue(rowIndex, col.key, msg);
                            }
                        } catch {
                        }
                    }
                }
            });
        });

        const nestingRules = (config && config.validation && config.validation.nesting) || {
            mode: 'forbid',
            allowObjectPaths: ['meta'],
            allowArrayPaths: []
        };

        if (nestingRules.mode !== 'allow') {
            rows.forEach(function (row, rowIndex) {
                const violations = [];
                collectNestedViolations(row, '', {
                    allowObjectPaths: Array.isArray(nestingRules.allowObjectPaths) ? nestingRules.allowObjectPaths : ['meta'],
                    allowArrayPaths: Array.isArray(nestingRules.allowArrayPaths) ? nestingRules.allowArrayPaths : []
                }, violations);

                violations.forEach(function (violation) {
                    const msg = 'Row ' + (rowIndex + 1) + ": nested " + violation.type + " not allowed at '" + violation.path + "'.";
                    errors.push(msg);
                    const colKey = columnForPath(violation.path, cols);
                    if (colKey) addIssue(rowIndex, colKey, msg);
                });
            });
        }

        const uniqueKeys = config && config.validation ? config.validation.uniqueKeys : null;
        if (Array.isArray(uniqueKeys) && uniqueKeys.length > 0) {
            const seen = new Map();
            rows.forEach(function (row, rowIndex) {
                const composite = uniqueKeys.map(function (k) { return String(getByPath(row, k) ?? ''); }).join('||');
                if (!seen.has(composite)) seen.set(composite, []);
                seen.get(composite).push(rowIndex);
            });

            for (const rowIndexes of seen.values()) {
                if (rowIndexes.length <= 1) continue;
                rowIndexes.forEach(function (rowIndex) {
                    const msg = 'Row ' + (rowIndex + 1) + ': duplicate unique key (' + uniqueKeys.join(', ') + ').';
                    uniqueKeys.forEach(function (k) { addIssue(rowIndex, k, msg); });
                });
            }
        }

        const rowSummary = Array.from(rowSummaryMap.entries())
            .sort(function (a, b) { return a[0] - b[0]; })
            .map(function (entry) {
                return {
                    rowIndex: entry[0] + 1,
                    columns: Array.from(entry[1]).sort()
                };
            });

        return { errors: errors, cellErrors: cellErrors, rowSummary: rowSummary };
    }


    function getActiveNoteId() {
        try {
            return window.glob && window.glob.appContext && window.glob.appContext.tabManager
                ? window.glob.appContext.tabManager.getActiveContext().note.noteId
                : null;
        } catch {
            return null;
        }
    }

    async function getActiveNoteModel() {
        const noteId = getActiveNoteId();
        if (!isNonEmptyString(noteId)) return null;
        try {
            return await window.glob.froca.getNote(noteId);
        } catch {
            return null;
        }
    }

    function captureFocusState(mountEl) {
        const active = document.activeElement;
        if (!active || !mountEl.contains(active)) return null;
        const focusKey = active.dataset ? active.dataset.focusKey : null;
        if (!focusKey) return null;
        return {
            focusKey: focusKey,
            selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
            selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null
        };
    }

    function restoreFocusState(mountEl, focusState) {
        if (!focusState) return;
        const target = Array.from(mountEl.querySelectorAll('[data-focus-key]')).find(function (el) {
            return el.dataset && el.dataset.focusKey === focusState.focusKey;
        });
        if (!target) return;
        target.focus();
        if (focusState.selectionStart !== null && focusState.selectionEnd !== null && typeof target.setSelectionRange === 'function') {
            target.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
        }
    }

    function uninstallDirtyGuards(state) {
        if (!state || !state._guardsInstalled) return;
        if (state._beforeUnloadHandler) {
            window.removeEventListener('beforeunload', state._beforeUnloadHandler);
        }
        if (state._clickHandler) {
            document.removeEventListener('click', state._clickHandler, true);
        }
        state._guardsInstalled = false;
    }

    function installDirtyGuards(state) {
        if (state._guardsInstalled) return;
        state._guardsInstalled = true;

        state._beforeUnloadHandler = function (event) {
            if (!state.mountEl || !state.mountEl.isConnected) {
                uninstallDirtyGuards(state);
                return;
            }
            if (!state.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        };

        state._clickHandler = function (event) {
            if (!state.mountEl || !state.mountEl.isConnected) {
                uninstallDirtyGuards(state);
                return;
            }
            if (!state.dirty) return;
            if (state.mountEl && state.mountEl.contains(event.target)) return;
            const navTarget = event.target && event.target.closest
                ? event.target.closest('a[href^="#root/"], .fancytree-title, .tab-row-widget .tab-row-item')
                : null;
            if (!navTarget) return;
            const allow = window.confirm('You have unsaved JSON changes. Leave this note and discard them?');
            if (!allow) {
                event.preventDefault();
                event.stopPropagation();
                if (event.stopImmediatePropagation) event.stopImmediatePropagation();
                return;
            }
            state.dirty = false;
        };

        window.addEventListener('beforeunload', state._beforeUnloadHandler);
        document.addEventListener('click', state._clickHandler, true);
    }

    function rowMatchesFilters(row, config, filterText, columnFilters) {
        const cols = config.columns || [];
        const globalNeedle = String(filterText || '').trim().toLowerCase();

        if (globalNeedle) {
            const hit = cols.some(function (col) {
                return String(getByPath(row, col.key) ?? '').toLowerCase().includes(globalNeedle);
            });
            if (!hit) return false;
        }

        for (const col of cols) {
            const needle = String(columnFilters[col.key] || '').trim().toLowerCase();
            if (!needle) continue;
            const val = String(getByPath(row, col.key) ?? '').toLowerCase();
            if (!val.includes(needle)) return false;
        }

        return true;
    }

    function sortRows(rows, key, dir) {
        const factor = dir === 'desc' ? -1 : 1;
        rows.sort(function (a, b) {
            const av = getByPath(a, key);
            const bv = getByPath(b, key);
            const aNull = av === null || typeof av === 'undefined';
            const bNull = bv === null || typeof bv === 'undefined';
            if (aNull && bNull) return 0;
            if (aNull) return 1;
            if (bNull) return -1;
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
            return String(av).localeCompare(String(bv)) * factor;
        });
    }

    function autoFixRow(rowIndex, state) {
        const row = state.rows[rowIndex];
        if (!row) return;
        const cols = state.config.columns || [];

        cols.forEach(function (col) {
            const val = getByPath(row, col.key);
            const missing = val === null || typeof val === 'undefined' || (typeof val === 'string' && val.trim() === '');
            if (col.required && missing) {
                if (col.type === 'string' || col.type === 'string|null') {
                    setByPath(row, col.key, 'fix_' + col.key + '_' + (rowIndex + 1));
                } else {
                    setByPath(row, col.key, defaultValueForType(col.type));
                }
                return;
            }
            if (val !== null && typeof val !== 'undefined' && !typeValid(val, col.type)) {
                const parsed = parseTypeValue(val, col.type);
                setByPath(row, col.key, typeValid(parsed, col.type) ? parsed : defaultValueForType(col.type));
            }
        });

        state.dirty = true;
        state.message = 'Auto-fixed row ' + (rowIndex + 1) + '.';
        state.messageColor = '#333';
    }

    async function exportJson(state) {
        const payload = JSON.stringify(state.rows, null, 2);
        const safeTarget = String(state.config.targetNoteId || 'dataset').replace(/[^a-zA-Z0-9_-]/g, '_');

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: safeTarget + '.json',
                    types: [{
                        description: 'JSON Files',
                        accept: { 'application/json': ['.json'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(payload);
                await writable.close();
                return 'saved-via-dialog';
            } catch (err) {
                if (err && err.name === 'AbortError') return 'cancelled';
                throw err;
            }
        }

        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = safeTarget + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return 'downloaded';
    }

    async function importJsonFile(file, state) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('Imported JSON must be an array.');
        state.rows = deepClone(parsed);
        state.dirty = true;
        state.message = 'Imported ' + state.rows.length + ' row(s) from ' + file.name + '.';
        state.messageColor = '#333';
    }

    function openWarningsModal(title, lines, options) {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.35)';
        overlay.style.zIndex = '10000';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        const panel = document.createElement('div');
        panel.style.background = '#fff';
        panel.style.padding = '12px';
        panel.style.border = '1px solid #bbb';
        panel.style.width = '70vw';
        panel.style.maxWidth = '900px';
        panel.style.maxHeight = '75vh';
        panel.style.overflow = 'auto';
        panel.addEventListener('mousedown', function (event) { event.stopPropagation(); });
        panel.addEventListener('click', function (event) { event.stopPropagation(); });

        const header = document.createElement('div');
        header.style.fontWeight = '700';
        header.style.marginBottom = '8px';
        header.textContent = title || 'Warnings';

        const body = document.createElement('div');
        body.style.fontFamily = 'monospace';
        body.style.fontSize = '12px';
        body.style.whiteSpace = 'pre-wrap';
        body.style.lineHeight = '1.4';
        body.style.marginBottom = '10px';
        const safeLines = Array.isArray(lines) && lines.length ? lines : ['No details.'];
        body.textContent = safeLines.join('\n');

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '8px';
        const opts = options && typeof options === 'object' ? options : {};
        const showPrimary = typeof opts.onPrimaryAction === 'function';
        const primaryLabel = isNonEmptyString(opts.primaryLabel) ? opts.primaryLabel : 'Go to first invalid cell';

        if (showPrimary) {
            const primaryBtn = document.createElement('button');
            primaryBtn.type = 'button';
            primaryBtn.textContent = primaryLabel;
            primaryBtn.onclick = function () {
                try {
                    opts.onPrimaryAction();
                } finally {
                    close();
                }
            };
            controls.appendChild(primaryBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = 'Close';

        function close() {
            document.removeEventListener('keydown', onEsc, true);
            overlay.remove();
        }

        function onEsc(event) {
            const isEscape = event.key === 'Escape' || event.key === 'Esc' || event.keyCode === 27;
            if (!isEscape) return;
            event.preventDefault();
            event.stopPropagation();
            close();
        }

        closeBtn.onclick = close;
        controls.appendChild(closeBtn);
        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(controls);
        overlay.appendChild(panel);
        // Keep modal interaction explicit (Close button / Esc) to avoid accidental click-capture issues.
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onEsc, true);
        setTimeout(function () {
            if (document.activeElement === document.body && typeof closeBtn.focus === 'function') closeBtn.focus();
        }, 0);
    }

    function normalizeSubgridRows(arr) {
        return (Array.isArray(arr) ? arr : []).map(function (item) {
            if (item && typeof item === 'object' && !Array.isArray(item)) return deepClone(item);
            return { value: item };
        });
    }

    function inferSubgridColumns(rows, subgridConfig) {
        const configured = subgridConfig && Array.isArray(subgridConfig.columns)
            ? subgridConfig.columns.map(function (c) { return typeof c === 'string' ? c : c.key; }).filter(Boolean)
            : [];
        if (configured.length) return configured;

        const set = new Set();
        rows.forEach(function (row) {
            Object.keys(row || {}).forEach(function (k) { set.add(k); });
        });
        if (!set.size) set.add('value');
        return Array.from(set);
    }

    function openJsonArrayGridEditor(initialValue, onSave, subgridConfig, contextLabel) {
        const rows = normalizeSubgridRows(initialValue);
        let pendingFocusKey = null;

        function ensureAtLeastOneRow() {
            if (rows.length > 0) return;
            const configured = subgridConfig && Array.isArray(subgridConfig.columns)
                ? subgridConfig.columns
                : [];
            const seedRow = {};
            if (configured.length) {
                configured.forEach(function (raw) {
                    const def = typeof raw === 'string' ? { key: raw, type: 'string' } : raw;
                    if (!def || !def.key) return;
                    seedRow[def.key] = defaultValueForType(def.type || 'string');
                });
            } else {
                seedRow.value = '';
            }
            rows.push(seedRow);
        }

        ensureAtLeastOneRow();

        function getConfiguredColumnDefs(cfg) {
            if (!cfg || !Array.isArray(cfg.columns)) return null;
            return cfg.columns.map(function (raw) {
                if (typeof raw === 'string') return { key: raw, type: 'string', required: false };
                return {
                    key: raw.key,
                    type: raw.type || 'string',
                    required: !!raw.required,
                    validation: raw.validation || null,
                    options: Array.isArray(raw.options) ? raw.options : null,
                    optionsSource: raw.optionsSource || null,
                    optionsFromColumn: raw.optionsFromColumn || null,
                    subgrid: raw.subgrid || null
                };
            }).filter(function (d) { return d && d.key; });
        }

        function getRuntimeColumnDefs() {
            const configured = getConfiguredColumnDefs(subgridConfig);
            if (configured && configured.length) {
                return configured.map(function (def) {
                    let resolvedOptions = Array.isArray(def.options) ? def.options : null;

                    if (!resolvedOptions && isNonEmptyString(def.optionsSource) && subgridConfig && subgridConfig.optionSources) {
                        const fromSource = subgridConfig.optionSources[def.optionsSource];
                        if (Array.isArray(fromSource)) resolvedOptions = fromSource;
                    }

                    if (!resolvedOptions && isNonEmptyString(def.optionsFromColumn)) {
                        const seen = new Set();
                        rows.forEach(function (r) {
                            if (!r || typeof r !== 'object') return;
                            const v = r[def.optionsFromColumn];
                            if (v === null || typeof v === 'undefined' || String(v).trim() === '') return;
                            seen.add(String(v));
                        });
                        if (seen.size > 0) {
                            resolvedOptions = Array.from(seen).sort().map(function (v) {
                                return { value: v, label: v };
                            });
                        }
                    }

                    return Object.assign({}, def, { options: resolvedOptions });
                });
            }
            const inferredKeys = inferSubgridColumns(rows, null);
            return inferredKeys.map(function (k) {
                return { key: k, type: 'string', required: false, subgrid: null };
            });
        }

        function validateSubgridRowsDetailed(colDefs) {
            const errors = [];
            const cellErrors = new Map();

            function mark(ri, key, message) {
                cellErrors.set(ri + '|' + key, message);
                errors.push('Row ' + (ri + 1) + ' [' + key + ']: ' + message);
            }

            for (let ri = 0; ri < rows.length; ri++) {
                for (const colDef of colDefs) {
                    const val = rows[ri][colDef.key];
                    const valCfg = getValidationConfig(colDef);

                    if (colDef.required) {
                        const missing = val === null || typeof val === 'undefined' || (typeof val === 'string' && val.trim() === '');
                        if (missing) {
                            mark(ri, colDef.key, getRuleMessage(colDef, 'required', 'is required.'));
                            continue;
                        }
                    }

                    if (val !== null && typeof val !== 'undefined' && !typeValid(val, colDef.type)) {
                        mark(ri, colDef.key, getRuleMessage(colDef, 'type', 'must be ' + colDef.type + '.'));
                        continue;
                    }

                    const isEmpty = val === null || typeof val === 'undefined' || (typeof val === 'string' && val.trim() === '');
                    if (isEmpty) continue;

                    const allowedValues = getAllowedValues(colDef);
                    if (allowedValues.length > 0 && !allowedValues.includes(String(val))) {
                        mark(ri, colDef.key, getRuleMessage(colDef, 'allowedValues', 'must be one of: ' + allowedValues.join(', ')));
                    }

                    if (typeof valCfg.enumRequired === 'boolean' && valCfg.enumRequired === true && allowedValues.length > 0 && !allowedValues.includes(String(val))) {
                        mark(ri, colDef.key, getRuleMessage(colDef, 'enumRequired', 'requires a valid enum value.'));
                    }

                    if (colDef.type === 'number' && typeof val === 'number' && Number.isFinite(val)) {
                        if (typeof valCfg.min === 'number' && val < valCfg.min) {
                            mark(ri, colDef.key, getRuleMessage(colDef, 'min', 'must be >= ' + valCfg.min + '.'));
                        }
                        if (typeof valCfg.max === 'number' && val > valCfg.max) {
                            mark(ri, colDef.key, getRuleMessage(colDef, 'max', 'must be <= ' + valCfg.max + '.'));
                        }
                    }

                    if (colDef.type === 'string' || colDef.type === 'string|null') {
                        const s = String(val);
                        if (typeof valCfg.minLength === 'number' && s.length < valCfg.minLength) {
                            mark(ri, colDef.key, getRuleMessage(colDef, 'minLength', 'must be at least ' + valCfg.minLength + ' chars.'));
                        }
                        if (typeof valCfg.maxLength === 'number' && s.length > valCfg.maxLength) {
                            mark(ri, colDef.key, getRuleMessage(colDef, 'maxLength', 'must be at most ' + valCfg.maxLength + ' chars.'));
                        }
                        if (isNonEmptyString(valCfg.pattern)) {
                            try {
                                const rx = new RegExp(valCfg.pattern);
                                if (!rx.test(s)) {
                                    mark(ri, colDef.key, getRuleMessage(colDef, 'pattern', 'does not match required pattern.'));
                                }
                            } catch {
                                // ignore invalid pattern config
                            }
                        }
                    }
                }
            }

            return { errors: errors, cellErrors: cellErrors };
        }

        function summarizeJsonArrayValue(value) {
            if (value === null || typeof value === 'undefined' || value === '') return 'Nested rows: 0';
            if (!Array.isArray(value)) return 'Invalid JSON array';
            const first = value[0] && typeof value[0] === 'object' ? Object.keys(value[0])[0] : null;
            return 'Nested rows: ' + value.length + (first ? (' (first key: ' + first + ')') : '');
        }

        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.35)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        const panel = document.createElement('div');
        panel.addEventListener('mousedown', function (event) { event.stopPropagation(); });
        panel.addEventListener('click', function (event) { event.stopPropagation(); });
        panel.style.background = '#fff';
        panel.style.padding = '10px';
        panel.style.border = '1px solid #bbb';
        panel.style.width = '80vw';
        panel.style.maxWidth = '1000px';
        panel.style.maxHeight = '80vh';
        panel.style.overflow = 'auto';

        const titleEl = document.createElement('div');
        titleEl.style.fontWeight = '600';
        titleEl.style.marginBottom = '8px';

        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.gap = '6px';
        toolbar.style.marginBottom = '8px';

        const modalStack = window.__jsonAuthoringModalStack || (window.__jsonAuthoringModalStack = []);
        modalStack.push(overlay);

        function onEsc(event) {
            const isEscape = event.key === 'Escape' || event.key === 'Esc' || event.keyCode === 27;
            if (!isEscape) return;
            const top = modalStack[modalStack.length - 1];
            if (top !== overlay) return;
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            close();
        }

        function close() {
            document.removeEventListener('keydown', onEsc, true);
            window.removeEventListener('keydown', onEsc, true);
            const idx = modalStack.lastIndexOf(overlay);
            if (idx >= 0) modalStack.splice(idx, 1);
            overlay.remove();
        }

        document.addEventListener('keydown', onEsc, true);
        window.addEventListener('keydown', onEsc, true);

        function renderGrid() {
            while (panel.children.length > 2) panel.removeChild(panel.lastChild);

            const contextPrefix = contextLabel ? ('Subgrid: ' + contextLabel + ' ') : 'Subgrid ';
            titleEl.textContent = contextPrefix + '(rows: ' + rows.length + ')';

            const colDefs = getRuntimeColumnDefs();
            const validation = validateSubgridRowsDetailed(colDefs);

            const table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            table.style.fontSize = '12px';

            const thead = document.createElement('thead');
            const trh = document.createElement('tr');
            colDefs.forEach(function (colDef) {
                const th = document.createElement('th');
                th.style.textAlign = 'left';
                th.style.padding = '4px';
                th.style.borderBottom = '1px solid #bbb';
                th.textContent = colDef.key;
                trh.appendChild(th);
            });
            const tha = document.createElement('th');
            tha.textContent = 'Actions';
            tha.style.textAlign = 'left';
            tha.style.padding = '4px';
            tha.style.borderBottom = '1px solid #bbb';
            trh.appendChild(tha);
            thead.appendChild(trh);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            rows.forEach(function (row, ri) {
                const tr = document.createElement('tr');
                colDefs.forEach(function (colDef) {
                    const c = colDef.key;
                    const td = document.createElement('td');
                    td.style.padding = '4px';
                    td.style.borderBottom = '1px solid #eee';
                    const cellKey = ri + '|' + c;
                    const cellError = validation.cellErrors.get(cellKey) || null;

                    function applyCellErrorStyle(el) {
                        if (!cellError || !el) return;
                        el.style.border = '1px solid #b63a2b';
                        el.style.backgroundColor = '#fff5f5';
                        el.title = cellError;
                    }

                    function appendCellError(container) {
                        if (!cellError) return;
                        const errEl = document.createElement('div');
                        errEl.style.marginTop = '3px';
                        errEl.style.fontSize = '11px';
                        errEl.style.lineHeight = '1.2';
                        errEl.style.color = '#b63a2b';
                        errEl.textContent = cellError;
                        container.appendChild(errEl);
                    }

                    if (colDef.type === 'boolean') {
                        const input = document.createElement('select');
                        const optTrue = document.createElement('option');
                        optTrue.value = 'true';
                        optTrue.textContent = 'true';
                        const optFalse = document.createElement('option');
                        optFalse.value = 'false';
                        optFalse.textContent = 'false';
                        input.appendChild(optTrue);
                        input.appendChild(optFalse);
                        input.value = row[c] === true ? 'true' : 'false';
                        input.style.width = '100%';
                        input.dataset.focusKey = 'subgrid:' + ri + ':' + c;
                        applyCellErrorStyle(input);
                        input.onchange = function () { row[c] = input.value === 'true'; };
                        td.appendChild(input);
                        appendCellError(td);
                    } else if (colDef.type === 'json-array') {
                        if (!Array.isArray(row[c])) row[c] = [];

                        const wrap = document.createElement('div');
                        wrap.style.display = 'flex';
                        wrap.style.flexDirection = 'column';
                        wrap.style.gap = '4px';

                        const summary = document.createElement('div');
                        summary.style.fontSize = '11px';
                        const txt = summarizeJsonArrayValue(row[c]);
                        summary.textContent = txt;
                        summary.style.color = txt === 'Invalid JSON array' ? '#b63a2b' : '#666';
                        if (cellError) summary.style.color = '#b63a2b';

                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.textContent = 'Edit nested';
                        btn.dataset.focusKey = 'subgrid:' + ri + ':' + c;
                        btn.onclick = function () {
                            const nestedConfig = colDef.subgrid || null;
                            const nestedContext = contextLabel
                                ? (contextLabel + '.' + c)
                                : c;
                            openJsonArrayGridEditor(Array.isArray(row[c]) ? row[c] : [], function (nextArray) {
                                row[c] = nextArray;
                                renderGrid();
                            }, nestedConfig, nestedContext);
                        };

                        wrap.appendChild(summary);
                        wrap.appendChild(btn);
                        appendCellError(wrap);
                        td.appendChild(wrap);
                    } else {
                        const input = document.createElement('input');
                        // Use text input for numeric fields so invalid text can be entered and validated visibly.
                        input.type = 'text';
                        if (colDef.type === 'number') input.inputMode = 'decimal';
                        input.value = row[c] == null ? '' : String(row[c]);
                        input.style.width = '100%';
                        input.dataset.focusKey = 'subgrid:' + ri + ':' + c;
                        applyCellErrorStyle(input);
                        input.oninput = function () {
                            if (colDef.type === 'number') {
                                const n = Number(input.value);
                                row[c] = Number.isFinite(n) ? n : input.value;
                                return;
                            }
                            row[c] = input.value;
                        };
                        td.appendChild(input);
                        appendCellError(td);
                    }

                    tr.appendChild(td);
                });

                const tdAct = document.createElement('td');
                tdAct.style.padding = '4px';
                tdAct.style.borderBottom = '1px solid #eee';
                const del = document.createElement('button');
                del.type = 'button';
                del.textContent = 'Delete';
                del.onclick = function () { rows.splice(ri, 1); renderGrid(); };
                tdAct.appendChild(del);
                tr.appendChild(tdAct);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            panel.appendChild(table);

            if (validation.errors.length > 0) {
                const summary = document.createElement('div');
                summary.style.marginTop = '8px';
                summary.style.fontFamily = 'monospace';
                summary.style.fontSize = '12px';
                summary.style.color = '#b63a2b';
                summary.textContent = 'Validation: ' + validation.errors.length + ' issue(s) in subgrid.';
                panel.appendChild(summary);
            }

            if (pendingFocusKey) {
                const key = pendingFocusKey;
                pendingFocusKey = null;
                setTimeout(function () {
                    const target = panel.querySelector('[data-focus-key="' + key + '"]');
                    if (target && typeof target.focus === 'function') target.focus();
                }, 0);
            }
        }

        function mkBtn(label, handler) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.onclick = handler;
            return b;
        }

        toolbar.appendChild(mkBtn('Add row', function () {
            const row = {};
            getRuntimeColumnDefs().forEach(function (colDef) {
                row[colDef.key] = defaultValueForType(colDef.type || 'string');
            });
            rows.push(row);
            renderGrid();
        }));

        toolbar.appendChild(mkBtn('Cancel', close));

        toolbar.appendChild(mkBtn('Save subgrid', function () {
            const colDefs = getRuntimeColumnDefs();
            const validation = validateSubgridRowsDetailed(colDefs);
            const issues = validation.errors;

            if (issues.length > 0) {
                const firstInvalidKey = validation.cellErrors.keys().next().value || null;
                openWarningsModal(
                    'Subgrid validation failed (' + issues.length + ')',
                    issues.length > 200 ? issues.slice(0, 200).concat(['... +' + (issues.length - 200) + ' more']) : issues,
                    firstInvalidKey ? {
                        primaryLabel: 'Go to first invalid cell',
                        onPrimaryAction: function () {
                            const parts = String(firstInvalidKey).split('|');
                            if (parts.length !== 2) return;
                            const ri = Number(parts[0]);
                            const colKey = parts[1];
                            if (!Number.isFinite(ri) || !isNonEmptyString(colKey)) return;
                            pendingFocusKey = 'subgrid:' + ri + ':' + colKey;
                            renderGrid();
                        }
                    } : null
                );
                renderGrid();
                return;
            }

            onSave(deepClone(rows));
            close();
        }));

        panel.appendChild(titleEl);
        panel.appendChild(toolbar);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        renderGrid();
        setTimeout(function () {
            const firstInput = panel.querySelector('input,textarea,select');
            if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
        }, 0);
    }

    function createCellEditor(value, type, onChange, errorMessage, focusKey, subgridConfig) {
        let input;

        if (type === 'boolean') {
            input = document.createElement('select');
            const t = document.createElement('option');
            t.value = 'true';
            t.textContent = 'true';
            const f = document.createElement('option');
            f.value = 'false';
            f.textContent = 'false';
            input.appendChild(t);
            input.appendChild(f);
            input.value = value === true ? 'true' : 'false';
        } else if (type === 'json' || type === 'json-array') {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.gap = '4px';

            const summary = document.createElement('div');
            summary.style.fontSize = '11px';
            summary.style.color = '#666';

            let currentJsonArray = Array.isArray(value)
                ? deepClone(value)
                : (Array.isArray(parseTypeValue(value, 'json-array')) ? parseTypeValue(value, 'json-array') : []);

            function refreshJsonArraySummary(rawValue) {
                if (type !== 'json-array') return;

                const source = typeof rawValue === 'undefined' ? currentJsonArray : rawValue;

                if (source === null || typeof source === 'undefined' || source === '') {
                    currentJsonArray = [];
                    summary.style.color = '#666';
                    summary.textContent = 'Nested rows: 0';
                    return;
                }

                const parsed = typeof source === 'string' ? parseTypeValue(source, 'json-array') : source;
                if (!Array.isArray(parsed)) {
                    summary.textContent = 'Invalid JSON array';
                    summary.style.color = '#b63a2b';
                    return;
                }
                currentJsonArray = parsed;
                const first = parsed[0] && typeof parsed[0] === 'object' ? Object.keys(parsed[0])[0] : null;
                summary.style.color = '#666';
                summary.textContent = 'Nested rows: ' + parsed.length + (first ? (' (first key: ' + first + ')') : '');
            }

            input = document.createElement('textarea');
            input.rows = 3;
            input.style.resize = 'vertical';
            input.value = value == null ? '' : JSON.stringify(value);
            input.addEventListener('change', function () {
                onChange(parseTypeValue(input.value, type));
                refreshJsonArraySummary(input.value);
            });
            input.addEventListener('blur', function () {
                onChange(parseTypeValue(input.value, type));
                refreshJsonArraySummary(input.value);
            });
            wrapper.appendChild(input);

            if (type === 'json-array') {
                wrapper.appendChild(summary);
                refreshJsonArraySummary(value);

                const gridBtn = document.createElement('button');
                gridBtn.type = 'button';
                gridBtn.textContent = 'Edit subgrid';
                gridBtn.style.alignSelf = 'flex-start';
                gridBtn.onclick = function () {
                    const parsed = Array.isArray(currentJsonArray) ? currentJsonArray : [];
                    if (!Array.isArray(parsed)) {
                        window.alert('Current value is not a valid JSON array. Fix JSON first.');
                        return;
                    }
                    openJsonArrayGridEditor(parsed, function (nextArray) {
                        currentJsonArray = Array.isArray(nextArray) ? nextArray : [];
                        input.value = JSON.stringify(currentJsonArray);
                        onChange(currentJsonArray);
                        refreshJsonArraySummary(currentJsonArray);
                    }, subgridConfig, focusKey);
                };
                wrapper.appendChild(gridBtn);
            }

            input = wrapper;
        } else {
            input = document.createElement('input');
            // Use text input for numeric fields so invalid text can be entered and validated visibly.
            input.type = 'text';
            if (type === 'number') input.inputMode = 'decimal';
            input.value = value == null ? '' : String(value);
            input.addEventListener('input', function () { onChange(parseTypeValue(input.value, type)); });
            input.addEventListener('change', function () { onChange(parseTypeValue(input.value, type)); });
        }

        const focusEl = input.matches && input.matches('input,textarea,select')
            ? input
            : (input.querySelector ? input.querySelector('input,textarea,select') : null);

        if (focusEl) {
            focusEl.style.width = '100%';
            focusEl.dataset.focusKey = focusKey;
            if (errorMessage) {
                focusEl.style.border = '1px solid #b63a2b';
                focusEl.style.backgroundColor = '#fff5f5';
                focusEl.title = errorMessage;
            }
        }

        return input;
    }

    function render(state) {
        const mountEl = state.mountEl;
        if (!mountEl) return;

        const focusState = captureFocusState(mountEl);
        const validation = validateRowsDetailed(state.rows, state.config);

        const visibleIndexes = [];
        for (let i = 0; i < state.rows.length; i++) {
            if (rowMatchesFilters(state.rows[i], state.config, state.filterText, state.columnFilters)) visibleIndexes.push(i);
        }

        mountEl.innerHTML = '';

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '8px';
        controls.style.marginBottom = '8px';
        controls.style.flexWrap = 'wrap';

        const defaultSnapshotTitle = 'JSON Snapshot ' + new Date().toISOString().replace(/[:.]/g, '-');
        const childTitleInput = document.createElement('input');
        childTitleInput.type = 'text';
        childTitleInput.placeholder = 'Child snapshot title';
        childTitleInput.value = state.childSnapshotTitle || defaultSnapshotTitle;
        childTitleInput.style.minWidth = '260px';
        childTitleInput.oninput = function () {
            state.childSnapshotTitle = childTitleInput.value;
        };

        function mkBtn(label, handler) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.onclick = handler;
            return btn;
        }

        controls.appendChild(mkBtn('Add row', function () {
            const row = {};
            (state.config.columns || []).forEach(function (col) { setByPath(row, col.key, defaultValueForType(col.type)); });
            state.rows.push(row);
            state.dirty = true;
            render(state);
        }));

        controls.appendChild(mkBtn('Reload target', async function () {
            const allow = !state.dirty || window.confirm('Discard unsaved changes and reload from target note?');
            if (!allow) return;
            await state.reload();
            render(state);
        }));

        controls.appendChild(mkBtn('Validate + Save', async function () {
            const currentValidation = validateRowsDetailed(state.rows, state.config);
            if (currentValidation.errors.length) {
                state.message = 'Validation failed (' + currentValidation.errors.length + '): ' + currentValidation.errors[0];
                state.messageColor = '#b63a2b';
                const firstInvalidKey = currentValidation.cellErrors.keys().next().value || null;
                openWarningsModal(
                    'Validation failed (' + currentValidation.errors.length + ')',
                    currentValidation.errors.length > 300
                        ? currentValidation.errors.slice(0, 300).concat(['... +' + (currentValidation.errors.length - 300) + ' more'])
                        : currentValidation.errors,
                    firstInvalidKey ? {
                        primaryLabel: 'Go to first invalid cell',
                        onPrimaryAction: function () {
                            const parts = String(firstInvalidKey).split('|');
                            if (parts.length !== 2) return;
                            const ri = Number(parts[0]);
                            const colKey = parts[1];
                            if (!Number.isFinite(ri) || !isNonEmptyString(colKey)) return;
                            state.filterText = '';
                            state.columnFilters = {};
                            state.requestedFocusKey = 'cell:' + ri + ':' + colKey;
                            render(state);
                        }
                    } : null
                );
                render(state);
                return;
            }

            try {
                const bridge = resolveBridge();
                if (!bridge) throw new Error('JSON authoring bridge unavailable. Ensure #run=frontendStartup.');

                let revisionInfo = '';
                if (state.createRevisionOnSave) {
                    const revisionMethod = typeof bridge.createRevision === 'function'
                        ? await bridge.createRevision(state.config.targetNoteId)
                        : null;
                    revisionInfo = revisionMethod
                        ? ' (revision via ' + revisionMethod + ')'
                        : ' (revision requested but method unavailable)';
                }

                await bridge.saveContent(state.config.targetNoteId, JSON.stringify(state.rows, null, 2));
                state.dirty = false;
                state.message = 'Saved ' + state.rows.length + ' row(s) to ' + state.config.targetNoteId + revisionInfo + '.';
                state.messageColor = '#2c7a3f';
            } catch (err) {
                state.message = 'Save failed: ' + String(err && err.message ? err.message : err);
                state.messageColor = '#b63a2b';
            }
            render(state);
        }));

        controls.appendChild(childTitleInput);

        controls.appendChild(mkBtn('Save as child note', async function () {
            try {
                const bridge = resolveBridge();
                if (!bridge || typeof bridge.saveAsChildJson !== 'function') throw new Error('Save-as-child bridge unavailable.');

                const parentNoteId = state.hostNoteId || getActiveNoteId();
                if (!isNonEmptyString(parentNoteId)) throw new Error('No parent note id available.');

                const title = isNonEmptyString(state.childSnapshotTitle) ? state.childSnapshotTitle.trim() : defaultSnapshotTitle;
                const childNoteId = await bridge.saveAsChildJson(parentNoteId, title, JSON.stringify(state.rows, null, 2));
                state.message = childNoteId
                    ? 'Saved snapshot as child note ' + childNoteId + '.'
                    : 'Saved snapshot as child note.';
                state.messageColor = '#2c7a3f';
            } catch (err) {
                state.message = 'Save as child note failed: ' + String(err && err.message ? err.message : err);
                state.messageColor = '#b63a2b';
            }
            render(state);
        }));

        controls.appendChild(mkBtn('Export JSON', async function () {
            try {
                const result = await exportJson(state);
                state.message = result === 'saved-via-dialog'
                    ? 'Exported JSON via Save dialog.'
                    : (result === 'downloaded' ? 'Exported JSON via download.' : 'Export cancelled.');
                state.messageColor = '#333';
            } catch (err) {
                state.message = 'Export failed: ' + String(err && err.message ? err.message : err);
                state.messageColor = '#b63a2b';
            }
            render(state);
        }));

        const importInput = document.createElement('input');
        importInput.type = 'file';
        importInput.accept = '.json,application/json';
        importInput.style.display = 'none';
        importInput.onchange = async function () {
            try {
                const file = importInput.files && importInput.files[0] ? importInput.files[0] : null;
                if (!file) return;
                await importJsonFile(file, state);
            } catch (err) {
                state.message = 'Import failed: ' + String(err && err.message ? err.message : err);
                state.messageColor = '#b63a2b';
            }
            importInput.value = '';
            render(state);
        };

        controls.appendChild(mkBtn('Import JSON', function () { importInput.click(); }));
        controls.appendChild(importInput);

        const globalFilter = document.createElement('input');
        globalFilter.type = 'text';
        globalFilter.dataset.focusKey = 'global-filter';
        globalFilter.placeholder = 'Filter all columns...';
        globalFilter.value = state.filterText;
        globalFilter.style.minWidth = '220px';
        globalFilter.oninput = function () {
            state.filterText = globalFilter.value;
            render(state);
        };
        controls.appendChild(globalFilter);

        const revisionLabel = document.createElement('label');
        revisionLabel.style.display = 'inline-flex';
        revisionLabel.style.alignItems = 'center';
        revisionLabel.style.gap = '4px';
        revisionLabel.style.fontSize = '12px';
        const revisionToggle = document.createElement('input');
        revisionToggle.type = 'checkbox';
        revisionToggle.checked = !!state.createRevisionOnSave;
        revisionToggle.onchange = function () {
            state.createRevisionOnSave = !!revisionToggle.checked;
            state.message = 'Revision-on-save ' + (state.createRevisionOnSave ? 'enabled' : 'disabled') + '.';
            state.messageColor = '#333';
            render(state);
        };
        const revisionText = document.createElement('span');
        revisionText.textContent = 'Create revision before save';
        revisionLabel.appendChild(revisionToggle);
        revisionLabel.appendChild(revisionText);
        controls.appendChild(revisionLabel);

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.fontSize = '13px';

        const thead = document.createElement('thead');
        const hr = document.createElement('tr');

        (state.config.columns || []).forEach(function (col) {
            const th = document.createElement('th');
            th.style.textAlign = 'left';
            th.style.borderBottom = '1px solid #bbb';
            th.style.padding = '4px';
            th.style.whiteSpace = 'nowrap';
            th.textContent = col.key;

            if (col.sortable) {
                th.style.cursor = 'pointer';
                th.title = 'Click to sort';
                th.onclick = function () {
                    const nextDir = state.sortKey === col.key && state.sortDir === 'asc' ? 'desc' : 'asc';
                    state.sortKey = col.key;
                    state.sortDir = nextDir;
                    sortRows(state.rows, col.key, nextDir);
                    render(state);
                };
            }

            if (state.sortKey === col.key) {
                th.textContent += state.sortDir === 'asc' ? ' [asc]' : ' [desc]';
            }

            hr.appendChild(th);
        });

        const thActions = document.createElement('th');
        thActions.style.borderBottom = '1px solid #bbb';
        thActions.style.padding = '4px';
        thActions.textContent = 'Actions';
        hr.appendChild(thActions);

        thead.appendChild(hr);

        const filterRow = document.createElement('tr');
        (state.config.columns || []).forEach(function (col) {
            const td = document.createElement('td');
            td.style.padding = '4px';
            td.style.borderBottom = '1px solid #ddd';
            const input = document.createElement('input');
            input.type = 'text';
            input.dataset.focusKey = 'col-filter:' + col.key;
            input.placeholder = 'filter';
            input.value = state.columnFilters[col.key] || '';
            input.style.width = '100%';
            input.oninput = function () {
                state.columnFilters[col.key] = input.value;
                render(state);
            };
            td.appendChild(input);
            filterRow.appendChild(td);
        });
        const filterActionCell = document.createElement('td');
        filterActionCell.style.borderBottom = '1px solid #ddd';
        filterRow.appendChild(filterActionCell);
        thead.appendChild(filterRow);

        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        visibleIndexes.forEach(function (actualRowIndex) {
            const row = state.rows[actualRowIndex];
            const tr = document.createElement('tr');

            (state.config.columns || []).forEach(function (col) {
                const td = document.createElement('td');
                td.style.padding = '4px';
                td.style.borderBottom = '1px solid #eee';
                const value = getByPath(row, col.key);
                const key = actualRowIndex + '|' + col.key;
                const cellError = validation.cellErrors.get(key) || null;
                const subgridConfig = state.config && state.config.subgrids ? state.config.subgrids[col.key] : null;
                const editor = createCellEditor(value, col.type, function (nextVal) {
                    setByPath(row, col.key, nextVal);
                    state.dirty = true;
                }, cellError, 'cell:' + actualRowIndex + ':' + col.key, subgridConfig);
                td.appendChild(editor);
                tr.appendChild(td);
            });

            const tdAction = document.createElement('td');
            tdAction.style.padding = '4px';
            tdAction.style.borderBottom = '1px solid #eee';
            tdAction.style.display = 'flex';
            tdAction.style.gap = '4px';

            tdAction.appendChild(mkBtn('Auto-fix', function () {
                autoFixRow(actualRowIndex, state);
                render(state);
            }));
            tdAction.appendChild(mkBtn('Delete', function () {
                state.rows.splice(actualRowIndex, 1);
                state.dirty = true;
                render(state);
            }));

            tr.appendChild(tdAction);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);

        const meta = document.createElement('div');
        meta.style.marginTop = '8px';
        meta.style.fontFamily = 'monospace';
        meta.textContent = 'rows=' + state.rows.length + ' visible=' + visibleIndexes.length + ' dirty=' + (state.dirty ? 'yes' : 'no') + ' target=' + state.config.targetNoteId;

        const validationLine = document.createElement('div');
        validationLine.style.marginTop = '6px';
        validationLine.style.fontFamily = 'monospace';
        validationLine.style.color = validation.errors.length ? '#b63a2b' : '#2c7a3f';
        validationLine.textContent = validation.errors.length
            ? 'Validation: ' + validation.errors.length + ' issue(s)'
            : 'Validation: no issues';

        const validationDetails = document.createElement('div');
        validationDetails.style.marginTop = '4px';
        validationDetails.style.fontFamily = 'monospace';
        validationDetails.style.fontSize = '12px';
        validationDetails.style.color = '#666';
        if (validation.rowSummary && validation.rowSummary.length) {
            const items = validation.rowSummary.slice(0, 6).map(function (entry) {
                return 'Row ' + entry.rowIndex + ' [' + entry.columns.join(', ') + ']';
            });
            validationDetails.textContent = 'Affected: ' + items.join(' | ')
                + (validation.rowSummary.length > 6 ? ' | …' : '');
        } else {
            validationDetails.textContent = '';
        }

        const message = document.createElement('div');
        message.style.marginTop = '6px';
        message.style.fontFamily = 'monospace';
        message.style.color = state.messageColor || '#333';
        message.textContent = state.message || '';

        mountEl.appendChild(controls);
        mountEl.appendChild(table);
        mountEl.appendChild(meta);
        mountEl.appendChild(validationLine);
        mountEl.appendChild(validationDetails);
        mountEl.appendChild(message);

        const effectiveFocusState = isNonEmptyString(state.requestedFocusKey)
            ? { focusKey: state.requestedFocusKey, selectionStart: null, selectionEnd: null }
            : focusState;
        state.requestedFocusKey = null;
        restoreFocusState(mountEl, effectiveFocusState);
    }

    async function resolveRuntimeConfig(initConfig) {
        const hostNote = await getActiveNoteModel();
        const configNoteId = hostNote && hostNote.getLabelValue
            ? (hostNote.getLabelValue('jsonAuthoringConfigNoteId') || initConfig.configNoteId)
            : initConfig.configNoteId;

        if (!isNonEmptyString(configNoteId)) {
            throw new Error('No config note id provided. Set init config or host label #jsonAuthoringConfigNoteId.');
        }

        const configText = await fetchNoteText(configNoteId);
        const parsedConfig = JSON.parse(configText);

        const targetOverride = hostNote && hostNote.getLabelValue ? hostNote.getLabelValue('jsonAuthoringTargetNoteId') : null;
        if (isNonEmptyString(targetOverride)) parsedConfig.targetNoteId = targetOverride;

        if (!isNonEmptyString(parsedConfig.targetNoteId)) throw new Error('No targetNoteId in resolved config.');

        const revLabel = hostNote && hostNote.getLabelValue ? hostNote.getLabelValue('jsonAuthoringCreateRevisionOnSave') : null;
        const createRevisionOnSave = revLabel == null || revLabel === '' ? true : isTruthyLabelValue(revLabel);

        return {
            parsedConfig: parsedConfig,
            configNoteId: configNoteId,
            hostNoteId: hostNote ? hostNote.noteId : null,
            createRevisionOnSave: createRevisionOnSave
        };
    }

    window.initJsonAuthoringMvp = async function initJsonAuthoringMvp(config) {
        const mountEl = document.getElementById(config.mountId);
        if (!mountEl) throw new Error("Mount element '" + config.mountId + "' not found.");

        const resolved = await resolveRuntimeConfig(config);
        const targetText = await fetchNoteText(resolved.parsedConfig.targetNoteId);
        const rows = JSON.parse(targetText);
        if (!Array.isArray(rows)) throw new Error('Target JSON must be an array.');

        const state = {
            mountEl: mountEl,
            config: resolved.parsedConfig,
            rows: deepClone(rows),
            sortKey: null,
            sortDir: 'asc',
            filterText: '',
            columnFilters: {},
            dirty: false,
            childSnapshotTitle: '',
            hostNoteId: resolved.hostNoteId,
            createRevisionOnSave: resolved.createRevisionOnSave,
            message: 'Loaded config=' + resolved.configNoteId + ' target=' + resolved.parsedConfig.targetNoteId +
                ' host=' + (resolved.hostNoteId || 'n/a') + ' revisionOnSave=' + (resolved.createRevisionOnSave ? 'on' : 'off'),
            messageColor: '#333',
            reload: async function () {
                const refreshed = JSON.parse(await fetchNoteText(resolved.parsedConfig.targetNoteId));
                state.rows = deepClone(refreshed);
                state.dirty = false;
                state.message = 'Reloaded from target note.';
                state.messageColor = '#333';
            }
        };

        installDirtyGuards(state);
        render(state);
    };

    resolveBridge();
})();
