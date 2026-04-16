import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

import "./SqlEditor.css";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export default function SqlEditorImpl({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value,
      language: "sql",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      tabSize: 2,
    });
    editorRef.current = editor;
    const sub = editor.onDidChangeModelContent(() => onChange(editor.getValue()));
    return () => {
      sub.dispose();
      editor.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  return <div ref={containerRef} className="sql-editor" />;
}
