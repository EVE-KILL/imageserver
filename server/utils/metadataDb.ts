import { Database } from 'bun:sqlite';
import path from 'node:path';

const DB_PATH = './cache/metadata.db';
const CACHE_VALIDATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

export interface CacheMetadataRow {
  cache_path: string;
  etag: string;
  last_checked: number;
  last_modified: number;
  cache_expiry: number;
  last_accessed: number;
  file_size: number;
}

export interface CategoryStats {
  fileCount: number;
  totalSizeKB: number;
}

let db: Database;

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=NORMAL');
    db.exec('PRAGMA cache_size=-8000'); // 8MB cache
    db.exec('PRAGMA busy_timeout=5000');

    db.exec(`
      CREATE TABLE IF NOT EXISTS cache_metadata (
        cache_path TEXT PRIMARY KEY,
        etag TEXT NOT NULL,
        last_checked INTEGER NOT NULL,
        last_modified INTEGER NOT NULL,
        cache_expiry INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        file_size INTEGER DEFAULT 0
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_metadata(cache_expiry)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_last_accessed ON cache_metadata(last_accessed)');
  }
  return db;
}

// Prepared statements (lazy-initialized)
let _stmtSave: ReturnType<Database['prepare']>;
let _stmtLoad: ReturnType<Database['prepare']>;
let _stmtDelete: ReturnType<Database['prepare']>;
let _stmtTouch: ReturnType<Database['prepare']>;
let _stmtExpired: ReturnType<Database['prepare']>;
let _stmtStale: ReturnType<Database['prepare']>;
let _stmtUpdateValidation: ReturnType<Database['prepare']>;
let _stmtStats: ReturnType<Database['prepare']>;
let _stmtDeleteByPrefix: ReturnType<Database['prepare']>;
let _stmtFindByPrefix: ReturnType<Database['prepare']>;

function stmtSave() {
  return _stmtSave ??= getDb().prepare(`
    INSERT OR REPLACE INTO cache_metadata
      (cache_path, etag, last_checked, last_modified, cache_expiry, last_accessed, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
}

function stmtLoad() {
  return _stmtLoad ??= getDb().prepare('SELECT * FROM cache_metadata WHERE cache_path = ?');
}

function stmtDelete() {
  return _stmtDelete ??= getDb().prepare('DELETE FROM cache_metadata WHERE cache_path = ?');
}

function stmtTouch() {
  return _stmtTouch ??= getDb().prepare('UPDATE cache_metadata SET last_accessed = ? WHERE cache_path = ?');
}

function stmtExpired() {
  return _stmtExpired ??= getDb().prepare(
    'SELECT cache_path FROM cache_metadata WHERE cache_expiry < ? LIMIT ?'
  );
}

function stmtStale() {
  return _stmtStale ??= getDb().prepare(
    'SELECT cache_path, file_size FROM cache_metadata WHERE last_accessed < ? AND cache_path NOT LIKE ? LIMIT ?'
  );
}

function stmtUpdateValidation() {
  return _stmtUpdateValidation ??= getDb().prepare(
    'UPDATE cache_metadata SET etag = ?, last_checked = ?, cache_expiry = ? WHERE cache_path = ?'
  );
}

function stmtStats() {
  return _stmtStats ??= getDb().prepare(`
    SELECT
      substr(cache_path, 1, instr(cache_path, '/') - 1) AS category,
      COUNT(*) AS fileCount,
      COALESCE(SUM(file_size), 0) / 1024 AS totalSizeKB
    FROM cache_metadata
    GROUP BY category
  `);
}

function stmtDeleteByPrefix() {
  return _stmtDeleteByPrefix ??= getDb().prepare('DELETE FROM cache_metadata WHERE cache_path LIKE ?');
}

function stmtFindByPrefix() {
  return _stmtFindByPrefix ??= getDb().prepare('SELECT cache_path FROM cache_metadata WHERE cache_path LIKE ?');
}

/**
 * Save or update metadata for a cached file
 */
export function saveMetadata(cachePath: string, etag: string, fileSize: number = 0): void {
  const now = Date.now();
  const normalizedPath = normalizePath(cachePath);
  stmtSave().run(
    normalizedPath,
    etag,
    now,                              // last_checked
    now,                              // last_modified
    now + CACHE_VALIDATION_INTERVAL,  // cache_expiry
    now,                              // last_accessed
    fileSize
  );
}

/**
 * Load metadata for a cached file
 */
export function loadMetadata(cachePath: string): CacheMetadataRow | null {
  const normalizedPath = normalizePath(cachePath);
  return stmtLoad().get(normalizedPath) as CacheMetadataRow | null;
}

/**
 * Delete metadata for a cached file
 */
export function deleteMetadata(cachePath: string): void {
  const normalizedPath = normalizePath(cachePath);
  stmtDelete().run(normalizedPath);
}

/**
 * Delete all metadata entries matching a prefix (e.g. "characters/21/15/2115142978")
 * Used to remove all variants of an ID
 */
export function deleteMetadataByPrefix(prefix: string): void {
  stmtDeleteByPrefix().run(`${prefix}%`);
}

/**
 * Find all cache paths matching a prefix
 */
export function findByPrefix(prefix: string): string[] {
  const rows = stmtFindByPrefix().all(`${prefix}%`) as { cache_path: string }[];
  return rows.map(r => r.cache_path);
}

/**
 * Get entries that need validation (cache_expiry has passed)
 */
export function getExpiredEntries(limit: number = 1000): string[] {
  const rows = stmtExpired().all(Date.now(), limit) as { cache_path: string }[];
  return rows.map(r => r.cache_path);
}

/**
 * Get entries not accessed since cutoff, excluding a category prefix
 * Used for cache eviction
 */
export function getStaleEntries(cutoffMs: number, excludePrefix: string, limit: number = 1000): { cache_path: string; file_size: number }[] {
  return stmtStale().all(cutoffMs, `${excludePrefix}%`, limit) as { cache_path: string; file_size: number }[];
}

/**
 * Update last_accessed timestamp on cache hit
 */
export function touchAccessed(cachePath: string): void {
  const normalizedPath = normalizePath(cachePath);
  stmtTouch().run(Date.now(), normalizedPath);
}

/**
 * Update validation info after checking upstream
 */
export function updateValidation(cachePath: string, etag: string): void {
  const now = Date.now();
  const normalizedPath = normalizePath(cachePath);
  stmtUpdateValidation().run(etag, now, now + CACHE_VALIDATION_INTERVAL, normalizedPath);
}

/**
 * Get aggregate stats per category (for /status endpoint)
 */
export function getStats(): Record<string, CategoryStats> {
  const rows = stmtStats().all() as { category: string; fileCount: number; totalSizeKB: number }[];
  const result: Record<string, CategoryStats> = {};
  for (const row of rows) {
    if (row.category) {
      result[row.category] = { fileCount: row.fileCount, totalSizeKB: row.totalSizeKB };
    }
  }
  return result;
}

/**
 * Check if a cached file needs validation
 */
export function needsValidation(cachePath: string): boolean {
  const meta = loadMetadata(cachePath);
  if (!meta) return true;
  return Date.now() > meta.cache_expiry;
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
  }
}

/**
 * Strip leading ./cache/ from paths for consistent storage
 * e.g. "./cache/characters/21/15/123.original" -> "characters/21/15/123.original"
 */
function normalizePath(p: string): string {
  if (p.startsWith('./cache/')) return p.slice(8);
  if (p.startsWith('cache/')) return p.slice(6);
  return p;
}
