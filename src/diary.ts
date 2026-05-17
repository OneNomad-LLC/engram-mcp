import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DiaryEntry } from './types.js';

/**
 * Agent diary -- persistent cross-session journal.
 *
 * Each day gets a markdown file: diary/YYYY-MM-DD.md
 * Entries are appended throughout the day with timestamps.
 * Human-readable and easy to grep.
 *
 * Unlike session state (ephemeral scratchpad), the diary builds
 * institutional knowledge about what happened over time.
 */

function diaryDir(dataDir: string): string {
  return join(dataDir, 'diary');
}

function diaryPath(dataDir: string, date: string): string {
  return join(diaryDir(dataDir), `${date}.md`);
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function now(): string {
  return new Date().toISOString().split('T')[1].split('.')[0];
}

/**
 * Write a diary entry for today.
 */
export function writeDiaryEntry(
  dataDir: string,
  content: string,
  agent: string = 'claude'
): DiaryEntry {
  const dir = diaryDir(dataDir);
  // 0700 = owner-only access (defensive; umask still applies on
  // existing dirs). Diary entries can include personal/work content.
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const date = today();
  const time = now();
  const path = diaryPath(dataDir, date);

  const entry: DiaryEntry = { date, time, content: content.trim(), agent };

  // Concurrent writers in a read-modify-write path can lose entries:
  // two callers both read the file, both build `existing + new`, both
  // writeFileSync — last write wins, the other entry is gone. Use
  // appendFileSync so each entry is its own filesystem write and the
  // OS append serializes. Header goes via writeFileSync only on file
  // creation (best-effort race; both callers writing the header is
  // benign — same content).
  const entryText = `## ${time} (${agent})\n\n${entry.content}\n\n`;
  if (!existsSync(path)) {
    writeFileSync(path, `# Diary -- ${date}\n\n${entryText}`, 'utf-8');
  } else {
    appendFileSync(path, entryText, 'utf-8');
  }

  return entry;
}

/**
 * Read diary entries.
 */
export function readDiary(
  dataDir: string,
  opts?: { date?: string; daysBack?: number; agent?: string }
): Array<{ date: string; entries: DiaryEntry[] }> {
  const dir = diaryDir(dataDir);
  if (!existsSync(dir)) return [];

  const dates: string[] = [];

  if (opts?.date) {
    dates.push(opts.date);
  } else {
    const daysBack = opts?.daysBack ?? 7;
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
      .sort()
      .reverse();

    const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString().split('T')[0];
    for (const f of files) {
      if (f >= cutoff) dates.push(f);
    }
  }

  const results: Array<{ date: string; entries: DiaryEntry[] }> = [];

  for (const date of dates) {
    const path = diaryPath(dataDir, date);
    if (!existsSync(path)) continue;

    const text = readFileSync(path, 'utf-8');
    const entries = parseDiaryFile(date, text);

    const filtered = opts?.agent
      ? entries.filter(e => e.agent === opts.agent)
      : entries;

    if (filtered.length > 0) {
      results.push({ date, entries: filtered });
    }
  }

  return results;
}

/**
 * List all diary dates.
 */
export function listDiaryDates(dataDir: string): string[] {
  const dir = diaryDir(dataDir);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''))
    .sort()
    .reverse();
}

// ── Parser ──────────────────────────────────────────────────────────

function parseDiaryFile(date: string, text: string): DiaryEntry[] {
  const entries: DiaryEntry[] = [];
  const blocks = text.split(/^## /m).filter(b => b.trim());

  for (const block of blocks) {
    // Match: "HH:MM:SS (agent)\n\ncontent"
    const headerMatch = block.match(/^(\d{2}:\d{2}:\d{2})\s*\(([^)]+)\)\s*\n+([\s\S]*)/);
    if (headerMatch) {
      entries.push({
        date,
        time: headerMatch[1],
        agent: headerMatch[2].trim(),
        content: headerMatch[3].trim(),
      });
    }
  }

  return entries;
}
