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
        const cols = Array.isArray(config.columns) ? config.columns : [];

        function markCell(rowIndex, colKey, message) {
            cellErrors.set(rowIndex + '|' + colKey, message);
        }

        rows.forEach(function (row, rowIndex) {
            cols.forEach(function (col) {
                const val = getByPath(row, col.key);

                if (col.required) {
                    const missing = val === null || typeof val === 'undefined' || (typeof val === 'string' && val.trim() === '');
                    if (missing) {
                        const msg = 'Row ' + (rowIndex + 1) + ": '" + col.key + "' is required.";
                        errors.push(msg);
                        markCell(rowIndex, col.key, msg);
                        return;
                    }
                }

                if (val !== null && typeof val !== 'undefined' && !typeValid(val, col.type)) {
                    const msg = 'Row ' + (rowIndex + 1) + ": '" + col.key + "' must be " + col.type + '.';
                    errors.push(msg);
                    markCell(rowIndex, col.key, msg);
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
                    if (colKey) markCell(rowIndex, colKey, msg);
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
                    errors.push(msg);
                    uniqueKeys.forEach(function (k) { markCell(rowIndex, k, msg); });
                });
            }
        }

        return { errors: errors, cellErrors: cellErrors };
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

    function openJsonArrayGridEditor(initialValue, onSave, subgridConfig) {
        const rows = normalizeSubgridRows(initialValue);

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
                    subgrid: raw.subgrid || null
                };
            }).filter(function (d) { return d && d.key; });
        }

        function getRuntimeColumnDefs() {
            const configured = getConfiguredColumnDefs(subgridConfig);
            if (configured && configured.length) return configured;
            const inferredKeys = inferSubgridColumns(rows, null);
            return inferredKeys.map(function (k) {
                return { key: k, type: 'string', required: false, subgrid: null };
            });
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

        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.gap = '6px';
        toolbar.style.marginBottom = '8px';

        function close() {
            overlay.remove();
        }

        function renderGrid() {
            while (panel.children.length > 1) panel.removeChild(panel.lastChild);

            const colDefs = getRuntimeColumnDefs();

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

                    const stopInner = function (event) { event.stopPropagation(); };

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
                        input.addEventListener('mousedown', stopInner);
                        input.addEventListener('click', stopInner);
                        input.addEventListener('keydown', stopInner);
                        input.addEventListener('keyup', stopInner);
                        input.onchange = function () { row[c] = input.value === 'true'; };
                        td.appendChild(input);
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

                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.textContent = 'Edit nested';
                        btn.addEventListener('mousedown', stopInner);
                        btn.addEventListener('click', stopInner);
                        btn.onclick = function () {
                            const nestedConfig = colDef.subgrid || null;
                            openJsonArrayGridEditor(Array.isArray(row[c]) ? row[c] : [], function (nextArray) {
                                row[c] = nextArray;
                                renderGrid();
                            }, nestedConfig);
                        };

                        wrap.appendChild(summary);
                        wrap.appendChild(btn);
                        td.appendChild(wrap);
                    } else {
                        const input = document.createElement('input');
                        input.type = colDef.type === 'number' ? 'number' : 'text';
                        input.value = row[c] == null ? '' : String(row[c]);
                        input.style.width = '100%';
                        input.addEventListener('mousedown', stopInner);
                        input.addEventListener('click', stopInner);
                        input.addEventListener('keydown', stopInner);
                        input.addEventListener('keyup', stopInner);
                        input.oninput = function () {
                            if (colDef.type === 'number') {
                                const n = Number(input.value);
                                row[c] = Number.isFinite(n) ? n : input.value;
                                return;
                            }
                            row[c] = input.value;
                        };
                        td.appendChild(input);
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
            for (let ri = 0; ri < rows.length; ri++) {
                for (const colDef of colDefs) {
                    if (!colDef.required) continue;
                    const val = rows[ri][colDef.key];
                    const missing = val === null || typeof val === 'undefined' || (typeof val === 'string' && val.trim() === '');
                    if (missing) {
                        window.alert('Subgrid validation failed: row ' + (ri + 1) + " requires '" + colDef.key + "'.");
                        return;
                    }
                }
            }
            onSave(deepClone(rows));
            close();
        }));

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
                    }, subgridConfig);
                };
                wrapper.appendChild(gridBtn);
            }

            input = wrapper;
        } else {
            input = document.createElement('input');
            input.type = type === 'number' ? 'number' : 'text';
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

        const message = document.createElement('div');
        message.style.marginTop = '6px';
        message.style.fontFamily = 'monospace';
        message.style.color = state.messageColor || '#333';
        message.textContent = state.message || '';

        mountEl.appendChild(controls);
        mountEl.appendChild(table);
        mountEl.appendChild(meta);
        mountEl.appendChild(validationLine);
        mountEl.appendChild(message);

        restoreFocusState(mountEl, focusState);
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