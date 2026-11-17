// Blocked senders: rules (address, domain or regex) kept in blocklist.json on
// the server. New mail from a blocked sender is moved to the account's spam folder.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./config.js";
import { MailError } from "./mail.js";
import type { Address, BlockInput, BlockRule } from "./types.js";

const MAX_PATTERN = 300;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The rule's regular expression, checked (a bad regex is refused here, not at mail time). */
export function blockPattern({ kind, value }: BlockInput): string {
  const v = value.trim();
  if (!v) throw new MailError(400, "Say what to block");
  let pattern: string;
  if (kind === "address") {
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(v)) throw new MailError(400, `"${v}" isn't an email address`);
    pattern = `^${escape(v.toLowerCase())}$`;
  } else if (kind === "domain") {
    const domain = v.replace(/^.*@/, "").replace(/^\*?\.?/, "").toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new MailError(400, `"${v}" isn't a domain`);
    pattern = `@(.+\\.)?${escape(domain)}$`; // the domain and its subdomains
  } else {
    pattern = v;
  }
  if (pattern.length > MAX_PATTERN) throw new MailError(400, "That pattern is too long");
  try {
    new RegExp(pattern, "i");
  } catch (err) {
    throw new MailError(400, `Not a valid regular expression: ${(err as Error).message}`);
  }
  return pattern;
}

export class BlockList {
  private rules: BlockRule[];
  private compiled = new Map<string, RegExp>();

  constructor(private path: string) {
    this.rules = existsSync(path) ? ((JSON.parse(readFileSync(path, "utf8")) as { rules?: BlockRule[] }).rules ?? []) : [];
  }

  list(): BlockRule[] {
    return this.rules;
  }

  /** Adds a rule; the same pattern twice gives back the existing rule. */
  add(input: BlockInput): BlockRule {
    const pattern = blockPattern(input);
    const existing = this.rules.find((r) => r.pattern === pattern);
    if (existing) return existing;
    const rule: BlockRule = { id: randomBytes(4).toString("hex"), kind: input.kind, value: input.value.trim(), pattern, createdAt: new Date().toISOString(), hits: 0 };
    this.rules.push(rule);
    this.save();
    return rule;
  }

  remove(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.save();
  }

  /** The first rule that blocks this sender, if any. */
  match(from: Address): BlockRule | undefined {
    const address = from.address.trim().toLowerCase();
    if (!address) return undefined;
    const full = from.name ? `${from.name} <${address}>` : address;
    return this.rules.find((r) => {
      let re = this.compiled.get(r.pattern);
      if (!re) this.compiled.set(r.pattern, (re = new RegExp(r.pattern, "i")));
      return re.test(address) || re.test(full);
    });
  }

  /** Counts a message the rule sent to spam. */
  hit(id: string): void {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return;
    rule.hits += 1;
    this.save();
  }

  private save(): void {
    writeJsonAtomic(this.path, { version: 1, rules: this.rules });
  }
}
