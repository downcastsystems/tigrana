import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlockNodeView } from "./CodeBlockNodeView";
import { textblockTypeInputRule } from "@tiptap/core";

export { lowlight } from "./codeHighlighting";

export const CodeBlockWithControls = CodeBlockLowlight.extend({
  addInputRules() {
    return [textblockTypeInputRule({ find: /^```$/, type: this.type }), ...this.parent?.() ?? []];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
});
