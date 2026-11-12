// A minimal ZIP writer (deflate, UTF-8 names) for "download all attachments".
// Enough for a few files in memory; no dependency.
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  content: Buffer;
  date?: Date;
}

/** MS-DOS date and time, as ZIP stores them. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Distinct names: "a.pdf", "a (2).pdf"… (a ZIP can hold duplicates, but unzipping would overwrite). */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const name = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "attachment";
    const count = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  });
}

export function zip(entries: ZipEntry[]): Buffer {
  const names = uniqueNames(entries.map((e) => e.name));
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  entries.forEach((entry, i) => {
    const name = Buffer.from(names[i]!, "utf8");
    const compressed = deflateRawSync(entry.content);
    // Already-compressed files (images, PDFs…) can come out bigger: store those as they are.
    const stored = compressed.length >= entry.content.length;
    const data = stored ? entry.content : compressed;
    const method = stored ? 0 : 8;
    const crc = crc32(entry.content);
    const { time, date } = dosDateTime(entry.date ?? new Date());
    const flags = 0x0800; // file names are UTF-8

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.content.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(entry.content.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);

    offset += header.length + name.length + data.length;
  });

  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
