import { signatureText, type MailMessage } from "@mail-app/api-client";
import { MessageBody } from "./MessageBody";

/** How a signature will look in sent mail (HTML on web/desktop, plain text on phones). */
export function SignaturePreview({ html }: { html: string }) {
  const message = { html, text: signatureText(html) } as MailMessage;
  return <MessageBody message={message} />;
}
