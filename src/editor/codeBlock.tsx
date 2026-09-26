import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { DOMSerializer, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { Check, Copy, Menu, Plus, Scissors, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { writeRichClipboard } from "../lib/richClipboard";
import { normalizeTableClipboardHtml } from "./notesEditorBehavior";

export const lowlight = createLowlight(common);

function CodeBlockNodeView({
  editor,
  getPos,
  node,
  updateAttributes,
}: {
  editor: Editor;
  getPos: () => number | undefined;
  node: ProseMirrorNode;
  updateAttributes: (attrs: Record<string, unknown>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [blockCopied, setBlockCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const language = (node.attrs.language as string | null) ?? "";

  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (toolsRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menuOpen]);

  const resolvePos = () => {
    const pos = getPos();
    return typeof pos === "number" ? pos : null;
  };

  const selectCodeBlock = () => {
    const pos = resolvePos();
    if (pos == null) return;
    const { state, view } = editor;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
    view.focus();
  };

  const deleteCodeBlock = () => {
    const pos = resolvePos();
    const paragraph = editor.state.schema.nodes.paragraph;
    if (pos == null || !paragraph) return;

    const { state, view } = editor;
    const blockTo = pos + node.nodeSize;
    let tr = state.tr;

    if (state.doc.childCount === 1) {
      tr = tr.replaceWith(pos, blockTo, paragraph.create());
      tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(pos + 1, tr.doc.content.size)));
    } else {
      tr = tr.delete(pos, blockTo);
      const selectionPos = Math.min(pos, tr.doc.content.size);
      tr = tr.setSelection(Selection.near(tr.doc.resolve(selectionPos), -1));
    }

    view.dispatch(tr.scrollIntoView());
    view.focus();
    setMenuOpen(false);
  };

  const copyCodeBlockSection = async () => {
    const serialized = DOMSerializer.fromSchema(editor.state.schema).serializeNode(node);
    const container = document.createElement("div");
    container.appendChild(serialized);
    const html = normalizeTableClipboardHtml(container.innerHTML).trim();
    const markdown = htmlToMarkdown(html).trimEnd();
    await writeRichClipboard(html || markdownToHtml(markdown), markdown);
  };

  const handleCopySection = () => {
    void copyCodeBlockSection().then(() => {
      setBlockCopied(true);
      window.setTimeout(() => setBlockCopied(false), 1200);
    }).catch((error) => {
      console.error("Failed to copy code block", error);
    });
  };

  const handleCutSection = () => {
    void copyCodeBlockSection().then(() => {
      deleteCodeBlock();
    }).catch((error) => {
      console.error("Failed to cut code block", error);
    });
  };

  const insertParagraphNearBlock = (placement: "before" | "after") => {
    const pos = resolvePos();
    if (pos == null) return;
    const { state, view } = editor;
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return;
    const insertPos = placement === "before" ? pos : pos + node.nodeSize;
    const tr = state.tr.insert(insertPos, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView();
    view.dispatch(tr);
    view.focus();
    setMenuOpen(false);
  };

  const handleCopy = (event: React.MouseEvent) => {
    event.preventDefault();
    const text = node.textContent;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch((error) => {
      console.error("Failed to copy code", error);
    });
  };

  return (
    <NodeViewWrapper as="div" className={`code-block-node-view${menuOpen ? " is-active" : ""}`}>
      <div
        ref={toolsRef}
        className="code-block-side-tools"
        contentEditable={false}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className="code-block-menu-wrap">
          <button
            type="button"
            className="code-block-tool-button"
            title="Code block options"
            aria-label="Code block options"
            aria-expanded={menuOpen}
            onClick={() => {
              selectCodeBlock();
              setMenuOpen((value) => !value);
            }}
          >
            <Menu size={16} />
          </button>
          {menuOpen ? (
            <div className="code-block-context-menu">
              <button type="button" onClick={handleCopySection}>
                {blockCopied ? <Check size={14} /> : <Copy size={14} />}
                <span>{blockCopied ? "Copied" : "Copy code block"}</span>
              </button>
              <button type="button" onClick={handleCutSection}>
                <Scissors size={14} />
                <span>Cut code block</span>
              </button>
              <button type="button" onClick={() => insertParagraphNearBlock("before")}>
                <Plus size={14} />
                <span>Add line above</span>
              </button>
              <button type="button" onClick={() => insertParagraphNearBlock("after")}>
                <Plus size={14} />
                <span>Add line below</span>
              </button>
              <button type="button" className="danger-item" onClick={deleteCodeBlock}>
                <Trash2 size={14} />
                <span>Delete code block</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <pre className="code-block">
        <div className="code-block-controls" contentEditable={false}>
          <select
            className="code-block-language"
            value={language}
            onChange={(event) => {
              const value = event.target.value;
              updateAttributes({ language: value || null });
            }}
            onMouseDown={(event) => event.stopPropagation()}
            aria-label="Code language"
          >
            <option value="">Plain text</option>
            {CODE_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
          <button
            type="button"
            className="code-block-copy"
            title={copied ? "Copied" : "Copy code"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleCopy}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}

const CODE_LANGUAGES: string[] = (() => {
  try {
    const list = lowlight.listLanguages();
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
})();

export const CodeBlockWithControls = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
});
