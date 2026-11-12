import { useState } from "react";
import { TextInput } from "react-native";
import { useColors } from "@/src/lib/theme";

export interface RichEditorProps {
  /** The draft to start from, as HTML (see draftToHtml). Read once. */
  initialHtml: string;
  /** Plain text for phones; also the HTML on web/desktop (RichEditor.web.tsx). */
  initialText: string;
  /** `html` is null on phones, which send plain text. */
  onChange: (html: string | null, text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Phones: a plain text box for now (formatting is web/desktop only, see RichEditor.web.tsx). */
export function RichEditor({ initialText, onChange, placeholder, autoFocus }: RichEditorProps) {
  const colors = useColors();
  const [text, setText] = useState(initialText);
  return (
    <TextInput
      value={text}
      onChangeText={(next) => {
        setText(next);
        onChange(null, next);
      }}
      multiline
      autoFocus={autoFocus}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      textAlignVertical="top"
      className="min-h-[320px] flex-1 py-4 text-[15px] leading-6 text-foreground font-sans"
    />
  );
}
