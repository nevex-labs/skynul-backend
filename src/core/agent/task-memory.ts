/**
 * TaskMemory — SQLite + FTS5 persistent memory for the computer-use agent.
 *
 * After each task, the vision model extracts learnings.
 * Before each new task, relevant memories are retrieved and injected as context.
 *
 * User facts — persistent key-value memories the user explicitly tells the agent
 * to remember (e.g. "remember that staging password is admin123").
 */

import { join } from 'path';
import Database from 'better-sqlite3';
import { getDataDir } from '../config';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = join(getDataDir(), 'memory.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL UNIQUE,
      prompt TEXT NOT NULL,
      outcome TEXT NOT NULL,
      learnings TEXT NOT NULL,
      provider TEXT,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS task_memories_fts USING fts5(
      prompt, learnings, content=task_memories, content_rowid=id
    );
    CREATE TRIGGER IF NOT EXISTS task_memories_ai AFTER INSERT ON task_memories BEGIN
      INSERT INTO task_memories_fts(rowid, prompt, learnings)
      VALUES (new.id, new.prompt, new.learnings);
    END;
    CREATE TRIGGER IF NOT EXISTS task_memories_ad AFTER DELETE ON task_memories BEGIN
      INSERT INTO task_memories_fts(task_memories_fts, rowid, prompt, learnings)
      VALUES ('delete', old.id, old.prompt, old.learnings);
    END;

    CREATE TABLE IF NOT EXISTS user_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS user_facts_fts USING fts5(
      fact, content=user_facts, content_rowid=id
    );
    CREATE TRIGGER IF NOT EXISTS user_facts_ai AFTER INSERT ON user_facts BEGIN
      INSERT INTO user_facts_fts(rowid, fact) VALUES (new.id, new.fact);
    END;
    CREATE TRIGGER IF NOT EXISTS user_facts_ad AFTER DELETE ON user_facts BEGIN
      INSERT INTO user_facts_fts(user_facts_fts, rowid, fact) VALUES ('delete', old.id, old.fact);
    END;
  `);
  return db;
}

export type TaskMemory = {
  prompt: string;
  outcome: 'completed' | 'failed';
  learnings: string;
};

export function saveMemory(entry: {
  taskId: string;
  prompt: string;
  outcome: 'completed' | 'failed';
  learnings: string;
  provider?: string;
  durationMs?: number;
}): void {
  try {
    getDb()
      .prepare(`
      INSERT OR REPLACE INTO task_memories (task_id, prompt, outcome, learnings, provider, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        entry.taskId,
        entry.prompt,
        entry.outcome,
        entry.learnings,
        entry.provider ?? null,
        entry.durationMs ?? null,
        Date.now()
      );
  } catch {
    // Non-critical
  }
}

export function searchMemories(query: string, limit = 3): TaskMemory[] {
  try {
    // Decay: boost recent memories by combining FTS rank with recency score
    const rows = getDb()
      .prepare(`
      SELECT t.prompt, t.outcome, t.learnings
      FROM task_memories_fts f
      JOIN task_memories t ON t.id = f.rowid
      WHERE task_memories_fts MATCH ?
      ORDER BY (rank * (1.0 + (CAST(? AS REAL) - t.created_at) / 2592000000.0))
      LIMIT ?
    `)
      .all(sanitizeFtsQuery(query), Date.now(), limit) as TaskMemory[];
    return rows;
  } catch {
    return [];
  }
}

export function formatMemoriesForPrompt(memories: TaskMemory[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m, i) => {
    const status = m.outcome === 'completed' ? 'SUCCESS' : 'FAILED';
    return `[Memory ${i + 1}] (${status}) Task: "${m.prompt}"\n${m.learnings}`;
  });
  return `\n## Past experience (use working selectors and avoid failed strategies):\n${lines.join('\n\n')}\n`;
}

// ── User facts ────────────────────────────────────────────────────────

export function saveFact(fact: string): void {
  try {
    const trimmed = fact.trim();
    if (!trimmed) return;
    // Dedup: skip if a very similar fact already exists
    const existing = getDb().prepare('SELECT id, fact FROM user_facts').all() as {
      id: number;
      fact: string;
    }[];
    const lower = trimmed.toLowerCase();
    for (const e of existing) {
      const eLower = e.fact.toLowerCase();
      // Exact or near-duplicate — update instead of inserting
      if (eLower === lower || eLower.includes(lower) || lower.includes(eLower)) {
        getDb().prepare('UPDATE user_facts SET fact = ?, created_at = ? WHERE id = ?').run(trimmed, Date.now(), e.id);
        return;
      }
    }
    getDb().prepare('INSERT INTO user_facts (fact, created_at) VALUES (?, ?)').run(trimmed, Date.now());
  } catch {
    /* non-critical */
  }
}

export function deleteFact(id: number): void {
  try {
    getDb().prepare('DELETE FROM user_facts WHERE id = ?').run(id);
  } catch {
    /* non-critical */
  }
}

export function listFacts(): { id: number; fact: string }[] {
  try {
    return getDb().prepare('SELECT id, fact FROM user_facts ORDER BY created_at DESC').all() as {
      id: number;
      fact: string;
    }[];
  } catch {
    return [];
  }
}

export function searchFacts(query: string, limit = 5): string[] {
  try {
    const all = getDb().prepare('SELECT fact FROM user_facts ORDER BY created_at DESC').all() as {
      fact: string;
    }[];
    // Few facts → inject all (minimal token cost, avoids FTS miss)
    if (all.length <= 20) return all.map((r) => r.fact);
    // Many facts → FTS search for relevance
    const rows = getDb()
      .prepare(`
      SELECT f.fact FROM user_facts_fts fts
      JOIN user_facts f ON f.id = fts.rowid
      WHERE user_facts_fts MATCH ?
      LIMIT ?
    `)
      .all(sanitizeFtsQuery(query), limit) as { fact: string }[];
    return rows.map((r) => r.fact);
  } catch {
    return [];
  }
}

export function formatFactsForPrompt(facts: string[]): string {
  if (facts.length === 0) return '';
  return `\n## Your memory (facts you know about the user and environment):\n${facts.map((f) => `- ${f}`).join('\n')}\n`;
}

export function closeMemoryDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function sanitizeFtsQuery(query: string): string {
  // Split into words and join with OR for fuzzy matching
  const words = query
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) return '""';
  return words.map((w) => `"${w}"`).join(' OR ');
}
