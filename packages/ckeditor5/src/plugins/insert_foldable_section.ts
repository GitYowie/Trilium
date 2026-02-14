import { ButtonView, Command, HtmlDataProcessor, Plugin } from "ckeditor5";
import type { Editor } from "ckeditor5";
import foldableSectionIcon from "../icons/foldable-section.svg?raw";

export const COMMAND_NAME = "insertFoldableSection";

export default class InsertFoldableSectionPlugin extends Plugin {
    private htmlDataProcessor!: HtmlDataProcessor;

    init() {
        this.htmlDataProcessor = new HtmlDataProcessor(this.editor.editing.view.document);

        const editor = this.editor;
        editor.commands.add(COMMAND_NAME, new InsertFoldableSectionCommand(editor, this.htmlDataProcessor));

        editor.ui.componentFactory.add("foldableSection", locale => {
            const view = new ButtonView(locale);
            const command = editor.commands.get(COMMAND_NAME)!;

            view.set({
                label: "Foldable section",
                icon: foldableSectionIcon,
                tooltip: true
            });

            view.bind("isEnabled").to(command, "isEnabled");
            view.on("execute", () => {
                editor.execute(COMMAND_NAME);
                editor.editing.view.focus();
            });

            return view;
        });
    }
}

class InsertFoldableSectionCommand extends Command {
    private readonly htmlDataProcessor: HtmlDataProcessor;

    constructor(editor: Editor, htmlDataProcessor: HtmlDataProcessor) {
        super(editor);
        this.htmlDataProcessor = htmlDataProcessor;
    }

    refresh() {
        this.isEnabled = !this.editor.isReadOnly;
    }

    execute() {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;

        let selectedHtml = "";
        if (!selection.isCollapsed) {
            const selectedContent = model.getSelectedContent(selection);
            const selectedView = editor.data.toView(selectedContent);
            selectedHtml = this.htmlDataProcessor.toData(selectedView).trim();
        }

        const { summary, bodyHtml } = getFoldablePartsFromSelection(selectedHtml);
        const html = `<details><summary>${escapeHtml(summary)}</summary>${bodyHtml}</details><p></p>`;
        const viewFragment = editor.data.processor.toView(html);
        const modelFragment = editor.data.toModel(viewFragment);

        model.change(writer => {
            if (!selection.isCollapsed) {
                model.deleteContent(selection);
            }

            model.insertContent(modelFragment, model.document.selection);

            // Place caret at end of inserted block by moving selection to current insertion end.
            writer.setSelection(model.document.selection.getLastPosition());
        });
    }
}

function getFoldablePartsFromSelection(selectedHtml: string): { summary: string; bodyHtml: string } {
    if (!selectedHtml) {
        return { summary: "Section", bodyHtml: "<p></p>" };
    }

    const container = document.createElement("div");
    container.innerHTML = selectedHtml;

    const meaningfulChildren = Array.from(container.childNodes).filter(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            return (node.textContent || "").trim().length > 0;
        }
        return true;
    });

    if (meaningfulChildren.length === 0) {
        return { summary: "Section", bodyHtml: "<p></p>" };
    }

    const firstNode = meaningfulChildren[0];
    const summary = ((firstNode.textContent || "").trim() || "Section").replace(/\s+/g, " ").slice(0, 120);

    if (meaningfulChildren.length === 1) {
        return { summary, bodyHtml: "<p></p>" };
    }

    const bodyWrap = document.createElement("div");
    for (const node of meaningfulChildren.slice(1)) {
        bodyWrap.appendChild(node.cloneNode(true));
    }

    return { summary, bodyHtml: bodyWrap.innerHTML || "<p></p>" };
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
