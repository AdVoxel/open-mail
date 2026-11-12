// User-defined labels (name + color). The definitions live in labels.json on
// the server; a message carries a label as the IMAP keyword `labelKeyword(id)`.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./config.js";
import type { MailLabel } from "./types.js";

const KEYWORD_PREFIX = "$OpenMail_";

/** The IMAP keyword that marks a message with this label. */
export function labelKeyword(id: string): string {
  return `${KEYWORD_PREFIX}${id}`;
}

/** Label ids found in a message's flags. */
export function labelsFromFlags(flags: Iterable<string> | undefined): string[] {
  const ids: string[] = [];
  for (const flag of flags ?? []) {
    if (flag.toLowerCase().startsWith(KEYWORD_PREFIX.toLowerCase())) ids.push(flag.slice(KEYWORD_PREFIX.length).toLowerCase());
  }
  return ids;
}

export class LabelStore {
  private labels: MailLabel[];

  constructor(private path: string) {
    this.labels = existsSync(path) ? ((JSON.parse(readFileSync(path, "utf8")) as { labels?: MailLabel[] }).labels ?? []) : [];
  }

  list(): MailLabel[] {
    return this.labels;
  }

  add(name: string, color: string): MailLabel {
    const label = { id: randomBytes(4).toString("hex"), name, color };
    this.labels.push(label);
    this.save();
    return label;
  }

  update(id: string, update: Partial<Omit<MailLabel, "id">>): MailLabel {
    const label = this.labels.find((l) => l.id === id);
    if (!label) throw new Error(`Label "${id}" not found`);
    if (update.name !== undefined) label.name = update.name;
    if (update.color !== undefined) label.color = update.color;
    this.save();
    return label;
  }

  /** Forgets the label. Messages keep the keyword, which is ignored from then on. */
  remove(id: string): void {
    this.labels = this.labels.filter((l) => l.id !== id);
    this.save();
  }

  private save(): void {
    writeJsonAtomic(this.path, { version: 1, labels: this.labels });
  }
}
