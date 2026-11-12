import { useCallback, useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import {
  Bold,
  Check,
  Italic,
  Link,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  TextQuote,
  Underline,
  X,
} from "lucide-react-native";
import { useColors } from "@/src/lib/theme";
import { IconButton } from "./kit";
import type { RichEditorProps } from "./RichEditor";

const PLACEHOLDER_STYLE = `
  [data-rich-editor][data-empty="true"]::before { content: attr(data-placeholder); color: var(--rich-editor-muted); pointer-events: none; position: absolute; }
  [data-rich-editor] blockquote { margin: 0 0 0 0.8ex; border-left: 2px solid var(--rich-editor-border); padding-left: 1ex; }
  [data-rich-editor] ul, [data-rich-editor] ol { margin: 0.25em 0; padding-left: 1.6em; }
  [data-rich-editor] ul { list-style: disc; }
  [data-rich-editor] ol { list-style: decimal; }
  [data-rich-editor] a { color: var(--rich-editor-link); text-decoration: underline; }
`;

/** Generic CSS families only: every device and mail client has a font for each. */
const TYPEFACES = [
  { value: "sans-serif", label: "Sans serif" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Monospace" },
] as const;
type Typeface = (typeof TYPEFACES)[number]["value"];

/** The generic family of a computed font-family list (what the cursor is in). */
function typefaceOf(fontName: string): Typeface {
  const name = fontName.toLowerCase();
  if (name.includes("monospace") || name.includes("mono")) return "monospace";
  if (/(^|[^-])serif/.test(name) && !name.includes("sans")) return "serif";
  return "sans-serif";
}

type Format = "bold" | "italic" | "underline" | "strikeThrough" | "insertUnorderedList" | "insertOrderedList";
const FORMATS: Format[] = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"];

/**
 * Formatting editor for web and desktop: a contenteditable area with a toolbar.
 * Uncontrolled: `initialHtml` is read once (remount with a new `key` to load
 * another draft); changes come back through `onChange`.
 */
export function RichEditor({ initialHtml, onChange, placeholder, autoFocus }: RichEditorProps) {
  const colors = useColors();
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [active, setActive] = useState<Partial<Record<Format | "quote", boolean>>>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [typeface, setTypeface] = useState<Typeface>("sans-serif");
  const [linkUrl, setLinkUrl] = useState("https://");

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const empty = !el.innerText.trim() && !el.querySelector("img, li, blockquote");
    el.dataset.empty = String(empty);
    onChange(empty ? "" : el.innerHTML, empty ? "" : el.innerText);
  }, [onChange]);

  // Load the draft once, put the cursor at the start (replies type above the quote).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Paragraphs as <div>s; a bare text node trips up list/quote commands in Chrome.
    document.execCommand("defaultParagraphSeparator", false, "div");
    el.innerHTML = initialHtml || "<div><br></div>";
    emit();
    if (autoFocus) {
      el.focus();
      const range = document.createRange();
      range.setStart(el, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Light up the toolbar buttons for the formatting at the cursor.
  useEffect(() => {
    const update = () => {
      const el = ref.current;
      const node = window.getSelection()?.anchorNode;
      if (!el || !node || !el.contains(node)) return;
      const next: typeof active = {};
      for (const format of FORMATS) next[format] = document.queryCommandState(format);
      next.quote = Boolean((node instanceof Element ? node : node.parentElement)?.closest("blockquote"));
      setActive(next);
      setTypeface(typefaceOf(document.queryCommandValue("fontName")));
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  const exec = (command: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, value);
    emit();
  };

  // A <select> takes focus away from the text: remember the selection to apply the typeface to.
  const rememberSelection = () => {
    const selection = window.getSelection();
    savedRange.current = selection && selection.rangeCount && ref.current?.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
  };

  const applyTypeface = (value: Typeface) => {
    setTypeface(value);
    ref.current?.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    exec("fontName", value);
  };

  const openLink = () => {
    const selection = window.getSelection();
    savedRange.current = selection && selection.rangeCount && ref.current?.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
    setLinkUrl("https://");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!url || url === "https://") return;
    ref.current?.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    // With nothing selected, insert the address itself as the link text.
    if (selection?.isCollapsed) exec("insertHTML", `<a href="${href.replace(/"/g, "&quot;")}">${href.replace(/</g, "&lt;")}</a>`);
    else exec("createLink", href);
  };

  const tool = (icon: typeof Bold, label: string, onPress: () => void, on?: boolean) => (
    <IconButton icon={icon} size={16} label={label} onPress={onPress} active={on} />
  );

  return (
    <View className="flex-1">
      <style>{PLACEHOLDER_STYLE}</style>
      {/* mousedown would move focus out of the text and lose the selection the button acts on */}
      <div onMouseDown={(e) => (e.target as HTMLElement).closest("input, select") || e.preventDefault()}>
        <View className="flex-row flex-wrap items-center gap-0.5 border-b border-border/70 py-1.5">
          <select
            aria-label="Typeface"
            title="Typeface"
            value={typeface}
            onMouseDown={rememberSelection}
            onFocus={rememberSelection}
            onChange={(e) => applyTypeface(e.target.value as Typeface)}
            style={{
              height: 32,
              marginRight: 4,
              padding: "0 6px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.background,
              color: colors.foreground,
              fontSize: 13,
              fontFamily: typeface,
              cursor: "pointer",
            }}
          >
            {TYPEFACES.map((t) => (
              <option key={t.value} value={t.value} style={{ fontFamily: t.value }}>
                {t.label}
              </option>
            ))}
          </select>
          <View className="mx-1 h-5 w-px bg-border" />
          {tool(Bold, "Bold (Ctrl+B)", () => exec("bold"), active.bold)}
          {tool(Italic, "Italic (Ctrl+I)", () => exec("italic"), active.italic)}
          {tool(Underline, "Underline (Ctrl+U)", () => exec("underline"), active.underline)}
          {tool(Strikethrough, "Strikethrough", () => exec("strikeThrough"), active.strikeThrough)}
          <View className="mx-1 h-5 w-px bg-border" />
          {tool(List, "Bulleted list", () => exec("insertUnorderedList"), active.insertUnorderedList)}
          {tool(ListOrdered, "Numbered list", () => exec("insertOrderedList"), active.insertOrderedList)}
          {tool(TextQuote, "Quote", () => exec("formatBlock", active.quote ? "div" : "blockquote"), active.quote)}
          {tool(Link, "Link", openLink, linkOpen)}
          <View className="mx-1 h-5 w-px bg-border" />
          {tool(RemoveFormatting, "Clear formatting", () => {
            exec("removeFormat");
            exec("unlink");
          })}
          {linkOpen ? (
            <View className="ml-2 min-w-[240px] flex-1 flex-row items-center gap-1">
              <TextInput
                autoFocus
                value={linkUrl}
                onChangeText={setLinkUrl}
                onSubmitEditing={applyLink}
                placeholder="https://example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground font-sans web:outline-none"
              />
              <IconButton icon={Check} size={16} label="Add link" onPress={applyLink} />
              <IconButton icon={X} size={16} label="Cancel" onPress={() => setLinkOpen(false)} />
            </View>
          ) : null}
        </View>
      </div>
      <div
        ref={ref}
        data-rich-editor=""
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        style={
          {
            position: "relative",
            minHeight: 320,
            padding: "16px 0",
            outline: "none",
            color: colors.foreground,
            fontSize: 15,
            lineHeight: "24px",
            fontFamily: "sans-serif",
            overflowWrap: "anywhere",
            "--rich-editor-muted": colors.muted,
            "--rich-editor-border": colors.border,
            "--rich-editor-link": colors.accent,
          } as React.CSSProperties
        }
      />
    </View>
  );
}
