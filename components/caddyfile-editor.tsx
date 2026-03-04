"use client";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "hsl(240 10% 3.9%)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "13px",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(240 10% 3.9%)",
    borderRight: "1px solid hsl(240 3.7% 15.9%)",
  },
});

interface CaddyfileEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function CaddyfileEditor({ value, onChange }: CaddyfileEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[StreamLanguage.define(nginx), theme]}
      theme={oneDark}
      height="100%"
      style={{ height: "100%", overflow: "hidden" }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        indentOnInput: true,
      }}
    />
  );
}
