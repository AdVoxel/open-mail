/**
 * Reply/forward prefixes mail clients put in front of a subject, in the
 * languages we meet: Re, Fw, Fwd (English), RES, ENC (Portuguese Outlook),
 * RV (Spanish), TR (French), AW, WG (German), SV, VS (Nordic), R, I (Italian).
 * Also matches counted forms like "Re[2]:" and "Re(2):".
 */
const PREFIX = /^\s*(?:re|fwd?|res|enc|rv|tr|aw|wg|sv|vs|r|i)\s*(?:\[\d+\]|\(\d+\))?\s*:\s*/i;
/** Tags mail gateways add, like "[EXT]" or "[External]". */
const TAG = /^\s*\[(?:ext|external|externo)\]\s*/i;

/**
 * A subject reduced to what identifies its conversation: without reply/forward
 * prefixes, case, or extra spaces. Messages with the same key are shown as one
 * conversation. An empty key means the subject identifies nothing (no subject).
 */
export function subjectKey(subject: string | undefined): string {
  let s = (subject ?? "").normalize("NFC");
  for (let before = ""; before !== s; ) {
    before = s;
    s = s.replace(PREFIX, "").replace(TAG, "");
  }
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s === "(no subject)" ? "" : s;
}
