// Minimal stub for `monaco-editor` used only under Vitest. The real
// monaco-editor has a heavy package.json exports map that vite's node
// resolver can't walk when there's no real need for it — these tests
// only touch type imports and the CompletionItemKind enum values. See
// vitest.config.ts for the alias wiring.
export const languages = {
  CompletionItemKind: {
    Keyword: 17,
    Module: 8,
    Class: 6,
    Field: 4,
  },
};
