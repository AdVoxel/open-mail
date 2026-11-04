import type { MailMessage } from "@mail-app/api-client";
import { Text } from "@/components/ui/text";

/** Phones show the plain-text version (the web/desktop build renders HTML, see MessageBody.web.tsx). */
export function MessageBody({ message }: { message: MailMessage }) {
  return (
    <Text selectable className="text-[15px] leading-6 text-foreground">
      {message.text.trim() || "(empty message)"}
    </Text>
  );
}
