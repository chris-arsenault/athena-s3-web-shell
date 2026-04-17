import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

import { useSchema, type SchemaValue } from "../../data/schemaContext";
import { buildSuggestions } from "./sqlCompletions";
import "./SqlEditor.css";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onRunAtCursor?: (offset: number) => void;
  onRunAll?: () => void;
  onRunSelection?: (text: string) => void;
}

interface HandlerRefs {
  runAtCursor: React.RefObject<((offset: number) => void) | undefined>;
  runAll: React.RefObject<(() => void) | undefined>;
  runSelection: React.RefObject<((text: string) => void) | undefined>;
}

const THEME_NAME = "athena-shell-dark";
let themeDefined = false;

function ensureTheme() {
  if (themeDefined) return;
  monaco.editor.defineTheme(THEME_NAME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e4ddcd", background: "09090c" },
      { token: "comment", foreground: "615a51", fontStyle: "italic" },
      { token: "keyword", foreground: "d8714e", fontStyle: "bold" },
      { token: "keyword.sql", foreground: "d8714e", fontStyle: "bold" },
      { token: "predefined.sql", foreground: "e8906d" },
      { token: "operator.sql", foreground: "bdb4a2" },
      { token: "string", foreground: "7edb86" },
      { token: "string.sql", foreground: "7edb86" },
      { token: "number", foreground: "e3a55a" },
      { token: "number.sql", foreground: "e3a55a" },
      { token: "identifier", foreground: "e4ddcd" },
      { token: "identifier.sql", foreground: "e4ddcd" },
      { token: "type", foreground: "6aa7d4" },
      { token: "delimiter", foreground: "8c8477" },
      { token: "delimiter.parenthesis.sql", foreground: "bdb4a2" },
    ],
    colors: {
      "editor.background": "#09090c",
      "editor.foreground": "#e4ddcd",
      "editor.lineHighlightBackground": "#15171e",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#9b422855",
      "editor.inactiveSelectionBackground": "#9b422833",
      "editor.selectionHighlightBackground": "#c0583a22",
      "editor.wordHighlightBackground": "#c0583a22",
      "editor.findMatchBackground": "#e3a55a55",
      "editor.findMatchHighlightBackground": "#e3a55a22",
      "editorLineNumber.foreground": "#474c5a",
      "editorLineNumber.activeForeground": "#d8714e",
      "editorCursor.foreground": "#d8714e",
      "editorWhitespace.foreground": "#22252e",
      "editorIndentGuide.background1": "#15171e",
      "editorIndentGuide.activeBackground1": "#2a2e38",
      "editorGutter.background": "#09090c",
      "editorBracketMatch.background": "#c0583a33",
      "editorBracketMatch.border": "#d8714e",
      "scrollbarSlider.background": "#2a2e3899",
      "scrollbarSlider.hoverBackground": "#363a46aa",
      "scrollbarSlider.activeBackground": "#474c5aaa",
      "editorWidget.background": "#111218",
      "editorWidget.border": "#2a2e38",
      "editorSuggestWidget.background": "#111218",
      "editorSuggestWidget.border": "#2a2e38",
      "editorSuggestWidget.selectedBackground": "#1b1d25",
      "editorSuggestWidget.highlightForeground": "#d8714e",
    },
  });
  themeDefined = true;
}

export default function SqlEditorImpl(props: Props) {
  const { value, onChange } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const schema = useSchema();
  const schemaRef = useRef<SchemaValue>(schema);
  schemaRef.current = schema;
  const runAtCursorRef = useRef(props.onRunAtCursor);
  const runAllRef = useRef(props.onRunAll);
  const runSelectionRef = useRef(props.onRunSelection);
  runAtCursorRef.current = props.onRunAtCursor;
  runAllRef.current = props.onRunAll;
  runSelectionRef.current = props.onRunSelection;

  useEffect(() => {
    if (!containerRef.current) return;
    ensureTheme();
    const editor = monaco.editor.create(containerRef.current, {
      value,
      language: "sql",
      theme: THEME_NAME,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily:
        '"Berkeley Mono", "Commit Mono", "JetBrains Mono", "Iosevka Term", "IBM Plex Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, ui-monospace, monospace',
      fontLigatures: true,
      fontSize: 13,
      lineHeight: 20,
      letterSpacing: 0.15,
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      glyphMargin: false,
      scrollBeyondLastLine: false,
      tabSize: 2,
      padding: { top: 14, bottom: 14 },
      renderLineHighlight: "line",
      cursorBlinking: "smooth",
      cursorWidth: 2,
      smoothScrolling: true,
      quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      scrollbar: {
        verticalSliderSize: 8,
        horizontalSliderSize: 8,
        useShadows: false,
      },
    });
    editorRef.current = editor;
    const sub = editor.onDidChangeModelContent(() => onChange(editor.getValue()));
    const completionProvider = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: ["."],
      provideCompletionItems: (model, position) =>
        buildSuggestions(model, position, schemaRef.current),
    });
    registerRunCommands(editor, {
      runAtCursor: runAtCursorRef,
      runAll: runAllRef,
      runSelection: runSelectionRef,
    });
    return () => {
      sub.dispose();
      completionProvider.dispose();
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

function registerRunCommands(
  editor: monaco.editor.IStandaloneCodeEditor,
  refs: HandlerRefs
): void {
  const mod = monaco.KeyMod;
  const key = monaco.KeyCode;
  editor.addCommand(mod.CtrlCmd | key.Enter, () => {
    const pos = editor.getPosition();
    const model = editor.getModel();
    if (!pos || !model) return;
    refs.runAtCursor.current?.(model.getOffsetAt(pos));
  });
  editor.addCommand(mod.CtrlCmd | mod.Shift | key.Enter, () => {
    refs.runAll.current?.();
  });
  editor.addCommand(mod.CtrlCmd | mod.Alt | key.Enter, () => {
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model || sel.isEmpty()) return;
    refs.runSelection.current?.(model.getValueInRange(sel));
  });
}
