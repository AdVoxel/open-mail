import { useState } from "react";
import { View } from "react-native";
import type { MailMessage } from "@mail-app/api-client";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { splitQuotedText } from "@/src/lib/quotes";

/**
 * Phones show the plain-text version (the web/desktop build renders HTML, see
 * MessageBody.web.tsx). The quoted history of a reply is folded away.
 */
export function MessageBody({ message }: { message: MailMessage }) {
  const [quoteShown, setQuoteShown] = useState(false);
  const split = splitQuotedText(message.text);
  return (
    <View>
      <Text selectable className="text-[15px] leading-6 text-foreground">
        {(split && !quoteShown ? split.fresh : message.text.trim()) || "(empty message)"}
      </Text>
      {split ? (
        <Pressable onPress={() => setQuoteShown((s) => !s)} className="mt-2 self-start rounded-md border border-border px-2 py-0.5">
          <Text size="xs" className="text-muted-foreground">
            {quoteShown ? "Hide quoted text" : "••• Show quoted text"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
