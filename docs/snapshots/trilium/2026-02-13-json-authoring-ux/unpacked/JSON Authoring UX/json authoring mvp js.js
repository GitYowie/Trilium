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
        return raw == null ? '' : String(raw);
    }

    function typeValid(value, type) {
        if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
        if (type === 'boolean') return typeof value === 'boolean';
        if (type === 'string') return typeof value === 'string';
        if (type === 'string|null') return value === null || typeof value === 'string';
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

    function createCellEditor(value, type, onChange, errorMessage, focusKey) {
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
        } else {
            input = document.createElement('input');
            input.type = type === 'number' ? 'number' : 'text';
            input.value = value == null ? '' : String(value);
        }

        input.style.width = '100%';
        input.dataset.focusKey = focusKey;

        if (errorMessage) {
            input.style.border = '1px solid #b63a2b';
            input.style.backgroundColor = '#fff5f5';
            input.title = errorMessage;
        }

        input.addEventListener('input', function () { onChange(parseTypeValue(input.value, type)); });
        input.addEventListener('change', function () { onChange(parseTypeValue(input.value, type)); });
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
                const editor = createCellEditor(value, col.type, function (nextVal) {
                    setByPath(row, col.key, nextVal);
                    state.dirty = true;
                }, cellError, 'cell:' + actualRowIndex + ':' + col.key);
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
