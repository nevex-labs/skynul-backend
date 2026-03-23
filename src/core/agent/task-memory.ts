/**
 * TaskMemory — SQLite + FTS5 persistent memory for the computer-use agent.
 *
 * After each task, the vision model extracts learnings.
 * Before each new task, relevant memories are retrieved and injected as context.
 *
 * User facts — persistent key-value memories the user explicitly tells the agent
 * to remember (e.g. "remember that staging password is admin123").
 */

import { createHash } from 'crypto';
import { join } from 'path';
import Database from 'better-sqlite3';
import { getDataDir } from '../config';

let db: Database.Database | null = null;

// ── Observations schema ────────────────────────────────────────────────────────

const OBSERVATIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    type TEXT NOT NULL DEFAULT 'manual',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    project TEXT,
    scope TEXT NOT NULL DEFAULT 'project',
    topic_key TEXT,
    normalized_hash TEXT,
    revision_count INTEGER NOT NULL DEFAULT 1,
    duplicate_count INTEGER NOT NULL DEFAULT 1,
    last_seen_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS obs_topic_key ON observations(topic_key) WHERE topic_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS obs_project ON observations(project) WHERE project IS NOT NULL;
  CREATE INDEX IF NOT EXISTS obs_type ON observations(type);
  CREATE INDEX IF NOT EXISTS obs_hash ON observations(normalized_hash) WHERE normalized_hash IS NOT NULL;
  CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    title, content, content=observations, content_rowid=id
  );
  CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO observations_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
  END;
`;

function initSchema(database: Database.Database): void {
  database.exec(`
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
  database.exec(OBSERVATIONS_SCHEMA);
  // eval-feedback tables (imported lazily to avoid circular dep)
  database.exec(EVAL_SCHEMA_PLACEHOLDER);
}

// Placeholder filled after eval-feedback module is available
// We inline the schema here to avoid circular imports
const EVAL_SCHEMA_PLACEHOLDER = `
  CREATE TABLE IF NOT EXISTS trade_scores (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL UNIQUE,
    venue         TEXT NOT NULL,
    capability    TEXT NOT NULL,
    symbol        TEXT,
    side          TEXT,
    entry_price   REAL,
    exit_price    REAL,
    size          REAL,
    pnl_usd       REAL NOT NULL DEFAULT 0,
    pnl_pct       REAL NOT NULL DEFAULT 0,
    score_pnl           REAL NOT NULL DEFAULT 0,
    score_discipline    REAL NOT NULL DEFAULT 0,
    score_efficiency    REAL NOT NULL DEFAULT 0,
    score_total         REAL NOT NULL DEFAULT 0,
    steps_used    INTEGER NOT NULL DEFAULT 0,
    max_steps     INTEGER NOT NULL DEFAULT 0,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    had_open_positions_at_done INTEGER NOT NULL DEFAULT 0,
    is_paper      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ts_venue ON trade_scores(venue);
  CREATE INDEX IF NOT EXISTS ts_capability ON trade_scores(capability);
  CREATE INDEX IF NOT EXISTS ts_created ON trade_scores(created_at);
  CREATE INDEX IF NOT EXISTS ts_paper ON trade_scores(is_paper);
`;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = join(getDataDir(), 'memory.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

/** Expose the shared memory db handle (used by eval-feedback for shared tables). */
export function getMemoryDb(): Database.Database {
  return getDb();
}

/** Replace the module-level db with a fresh in-memory instance (tests only). */
export function _initDbForTest(): void {
  if (db) {
    try { db.close(); } catch { /* ok */ }
  }
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initSchema(db);
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

// ── Observations (Engram-style structured memory) ────────────────────────────

export type Observation = {
  id: number;
  task_id?: string;
  type: string;
  title: string;
  content: string;
  project?: string;
  scope: string;
  topic_key?: string;
  normalized_hash?: string;
  revision_count: number;
  duplicate_count: number;
  last_seen_at?: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
};

/** SHA-256 hash of lowercased, trimmed title+content (for dedup). */
export function hashNormalized(title: string, content: string): string {
  const normalized = `${title.trim().toLowerCase()}|${content.trim().toLowerCase()}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

const DEDUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Save a structured observation.
 * - If topic_key matches an existing (non-deleted) row: upsert, bump revision_count.
 * - Else if same normalized_hash within 15-min window: bump duplicate_count.
 * - Otherwise: insert new row.
 * Returns the id of the affected row.
 */
export function saveObservation(params: {
  title: string;
  content: string;
  task_id?: string;
  obs_type?: string;
  project?: string;
  scope?: string;
  topic_key?: string;
}): number {
  try {
    const now = Date.now();
    const type = params.obs_type ?? 'manual';
    const scope = params.scope ?? 'project';
    const hash = hashNormalized(params.title, params.content);

    // 1. topic_key upsert
    if (params.topic_key) {
      const existing = getDb()
        .prepare(`SELECT id, revision_count FROM observations WHERE topic_key = ? AND deleted_at IS NULL LIMIT 1`)
        .get(params.topic_key) as { id: number; revision_count: number } | undefined;
      if (existing) {
        getDb()
          .prepare(
            `UPDATE observations SET title=?, content=?, type=?, project=?, scope=?, normalized_hash=?,
             revision_count=?, updated_at=? WHERE id=?`
          )
          .run(params.title, params.content, type, params.project ?? null, scope, hash,
               existing.revision_count + 1, now, existing.id);
        return existing.id;
      }
    }

    // 2. Hash dedup within 15-minute window
    const cutoff = now - DEDUP_WINDOW_MS;
    const dup = getDb()
      .prepare(`SELECT id, duplicate_count FROM observations WHERE normalized_hash = ? AND created_at >= ? AND deleted_at IS NULL LIMIT 1`)
      .get(hash, cutoff) as { id: number; duplicate_count: number } | undefined;
    if (dup) {
      getDb()
        .prepare(`UPDATE observations SET duplicate_count=?, last_seen_at=?, updated_at=? WHERE id=?`)
        .run(dup.duplicate_count + 1, now, now, dup.id);
      return dup.id;
    }

    // 3. Insert new observation
    const result = getDb()
      .prepare(
        `INSERT INTO observations (task_id, type, title, content, project, scope, topic_key, normalized_hash,
         revision_count, duplicate_count, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
      )
      .run(
        params.task_id ?? null,
        type,
        params.title,
        params.content,
        params.project ?? null,
        scope,
        params.topic_key ?? null,
        hash,
        now,
        now,
        now
      );
    return result.lastInsertRowid as number;
  } catch {
    return -1;
  }
}

/** Full-text search observations. Excludes soft-deleted. */
export function searchObservations(
  query: string,
  opts: { type_filter?: string; project?: string; limit?: number } = {}
): Observation[] {
  try {
    const ftsQ = sanitizeFtsQuery(query);
    if (ftsQ === '""') return [];
    let sql = `
      SELECT o.* FROM observations_fts f
      JOIN observations o ON o.id = f.rowid
      WHERE observations_fts MATCH ? AND o.deleted_at IS NULL
    `;
    const args: unknown[] = [ftsQ];
    if (opts.type_filter) { sql += ` AND o.type = ?`; args.push(opts.type_filter); }
    if (opts.project) { sql += ` AND o.project = ?`; args.push(opts.project); }
    sql += ` ORDER BY rank LIMIT ?`;
    args.push(opts.limit ?? 10);
    return getDb().prepare(sql).all(...args) as Observation[];
  } catch {
    return [];
  }
}

/** Retrieve recent observations (by updated_at). Excludes soft-deleted. */
export function getRecentObservations(
  opts: { type_filter?: string; project?: string; limit?: number } = {}
): Observation[] {
  try {
    let sql = `SELECT * FROM observations WHERE deleted_at IS NULL`;
    const args: unknown[] = [];
    if (opts.type_filter) { sql += ` AND type = ?`; args.push(opts.type_filter); }
    if (opts.project) { sql += ` AND project = ?`; args.push(opts.project); }
    sql += ` ORDER BY updated_at DESC, id DESC LIMIT ?`;
    args.push(opts.limit ?? 20);
    return getDb().prepare(sql).all(...args) as Observation[];
  } catch {
    return [];
  }
}

/** Soft-delete an observation by id. */
export function deleteObservation(id: number): void {
  try {
    getDb().prepare(`UPDATE observations SET deleted_at = ? WHERE id = ?`).run(Date.now(), id);
  } catch {
    /* non-critical */
  }
}

/** Format observations for injection into system prompt context. */
export function formatObservationsForPrompt(obs: Observation[]): string {
  if (obs.length === 0) return '';
  const lines = obs.map((o) => {
    const meta = [o.type, o.topic_key ? `key:${o.topic_key}` : null].filter(Boolean).join(', ');
    return `[${meta}] **${o.title}**: ${o.content}`;
  });
  return `\n## Knowledge memory:\n${lines.join('\n')}\n`;
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
