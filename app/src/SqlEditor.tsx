import { useEffect, useLayoutEffect, useRef } from "react";
import {
  EditorView,
  Decoration,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
export function SqlEditor({
  value,
  onChange,
  onRun,
  names = [],
  readOnly = false,
  errorPosition,
}: {
  value: string;
  onChange: (text: string) => void;
  onRun: (text: string, from: number) => void;
  names?: string[];
  readOnly?: boolean;
  errorPosition?: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | undefined>(undefined),
    callbacks = useRef({ onChange, onRun }),
    language = useRef(new Compartment()),
    access = useRef(new Compartment());
  callbacks.current = { onChange, onRun };
  const diagnostic = useRef(new Compartment());
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          highlightSelectionMatches(),
          access.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          language.current.of(sql({ dialect: PostgreSQL, schema: names })),
          diagnostic.current.of([]),
          autocompletion(),
          keymap.of([
            {
              key: "Mod-Enter",
              run: (v) => {
                const s = v.state.selection.main;
                callbacks.current.onRun(
                  s.empty ? "" : v.state.sliceDoc(s.from, s.to),
                  s.from,
                );
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...searchKeymap,
          ]),
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.keyword, color: "var(--sql-keyword)" },
              {
                tag: [tags.string, tags.special(tags.string)],
                color: "var(--sql-string)",
              },
              { tag: tags.number, color: "var(--sql-number)" },
              { tag: tags.comment, color: "var(--sql-comment)" },
              {
                tag: [tags.function(tags.variableName), tags.typeName],
                color: "var(--sql-function)",
              },
            ]),
          ),
          EditorView.theme({
            "&": {
              height: "100%",
              color: "var(--text)",
              backgroundColor: "var(--sql-background)",
              fontSize: "13px",
            },
            ".cm-scroller": {
              fontFamily: "Consolas, Menlo, monospace",
              overflow: "auto",
            },
            ".cm-content": { padding: "10px 0", caretColor: "var(--text)" },
            ".cm-gutters": {
              backgroundColor: "var(--sql-background)",
              color: "var(--muted)",
              border: "none",
            },
            ".cm-activeLine": { backgroundColor: "var(--sql-active)" },
            ".cm-activeLineGutter": { backgroundColor: "var(--sql-active)" },
            "&.cm-focused .cm-selectionBackground,.cm-selectionBackground": {
              backgroundColor: "var(--sql-selection)",
            },
            ".cm-tooltip": {
              backgroundColor: "var(--surface)",
              border: "1px solid var(--line)",
            },
            "&.cm-focused": { outline: "none" },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged)
              callbacks.current.onChange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": "SQL редактор" }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: access.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value)
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
      });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: language.current.reconfigure(
        sql({ dialect: PostgreSQL, schema: names }),
      ),
    });
  }, [names.join("\0")]);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const start =
      errorPosition === undefined
        ? undefined
        : Math.max(0, Math.min(v.state.doc.length - 1, errorPosition));
    const marks =
      start === undefined || v.state.doc.length === 0
        ? []
        : [
            Decoration.mark({ class: "sql-server-error" }).range(
              start,
              start + 1,
            ),
          ];
    v.dispatch({
      effects: diagnostic.current.reconfigure(
        EditorView.decorations.of(Decoration.set(marks)),
      ),
    });
  }, [errorPosition, value]);
  return <div className="sql-editor" ref={host} />;
}
