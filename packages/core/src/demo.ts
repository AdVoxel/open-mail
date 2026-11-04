import { triageEmail } from "./triage.js";
import { draftReply } from "./draftReply.js";
import type { Email } from "./client.js";

const email: Email = {
  from: "Dana Lee <dana@example.com>",
  to: "me@example.com",
  subject: "Q4 planning sync",
  date: "2026-11-03",
  body: `Hi,

Could we meet Thursday or Friday afternoon to go over the Q4 plan?
Please also send me the latest budget sheet before then.

Thanks,
Dana`,
};

const triage = await triageEmail(email);
console.log("Triage:", triage);

if (triage.needs_reply) {
  const reply = await draftReply(email, "Thursday at 3pm works; I'll send the sheet tomorrow.");
  console.log("\nDraft reply:\n" + reply);
}
