import "server-only";

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrateBilling } from "@/lib/billing/schema";
import { migrateOAuth } from "@/lib/oauth/schema";

/**
 * Persistence is node:sqlite, which ships inside Node itself. No native module to
 * compile, no ORM codegen, nothing to install on deploy. WAL is on so that a long
 * upscaling job writing library metadata never blocks a read.
 */

const DATA_DIR = process.env.LUMEN_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "lumen.db");

let instance: DatabaseSync | null = null;

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      email        TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      password     TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS library_items (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL,           -- 'image' | 'video' | 'audio' | 'document'
      folder        TEXT NOT NULL,           -- 'images' | 'videos' | 'audio' | 'documents'
      title         TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      mime          TEXT NOT NULL,
      ext           TEXT NOT NULL,
      bytes         INTEGER NOT NULL,
      width         INTEGER,
      height        INTEGER,
      duration      REAL,
      source_url    TEXT,
      engine        TEXT,
      meta          TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_library_user  ON library_items(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_library_folder ON library_items(user_id, folder, created_at DESC);
  `);
}

export function db(): DatabaseSync {
  if (instance) return instance;

  mkdirSync(DATA_DIR, { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");
  conn.exec("PRAGMA busy_timeout = 5000");
  migrate(conn);
  migrateBilling(conn);
  migrateOAuth(conn);

  instance = conn;
  return conn;
}

/**
 * Releases the connection. WAL mode keeps file handles open, which on Windows blocks
 * deleting the data directory, so anything that tears down a test database needs this.
 */
export function closeDb(): void {
  if (!instance) return;
  instance.close();
  instance = null;
}

export const FOLDERS = {
  image: "images",
  video: "videos",
  audio: "audio",
  document: "documents",
} as const;

export type Folder = (typeof FOLDERS)[keyof typeof FOLDERS];

/**
 * Kind is the singular used for filtering and API types. It cannot be derived by
 * trimming an "s": the audio folder is already singular and would become "audi".
 */
export const FOLDER_KIND: Record<Folder, "image" | "video" | "audio" | "document"> = {
  images: "image",
  videos: "video",
  audio: "audio",
  documents: "document",
};

export const FOLDER_ORDER: Folder[] = ["images", "videos", "audio", "documents"];

export const FOLDER_LABEL: Record<Folder, string> = {
  images: "Images",
  videos: "Videos",
  audio: "Audio",
  documents: "Documents",
};

/** Pick the library folder from the mime type so filing is never a user decision. */
export function folderForMime(mime: string): Folder {
  if (mime.startsWith("image/")) return FOLDERS.image;
  if (mime.startsWith("video/")) return FOLDERS.video;
  if (mime.startsWith("audio/")) return FOLDERS.audio;
  return FOLDERS.document;
}

export type LibraryItem = {
  id: string;
  user_id: string;
  kind: string;
  folder: string;
  title: string;
  original_name: string;
  stored_name: string;
  mime: string;
  ext: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  source_url: string | null;
  engine: string | null;
  meta: string | null;
  created_at: string;
};

export function listLibrary(
  userId: string,
  opts: { folder?: string; limit?: number; offset?: number } = {},
): LibraryItem[] {
  const limit = Math.min(opts.limit ?? 60, 200);
  const offset = opts.offset ?? 0;

  if (opts.folder) {
    return db()
      .prepare(
        `SELECT * FROM library_items
         WHERE user_id = ? AND folder = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, opts.folder, limit, offset) as LibraryItem[];
  }

  return db()
    .prepare(
      `SELECT * FROM library_items
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset) as LibraryItem[];
}

export function getLibraryItem(userId: string, id: string): LibraryItem | undefined {
  return db()
    .prepare("SELECT * FROM library_items WHERE id = ? AND user_id = ?")
    .get(id, userId) as LibraryItem | undefined;
}

export function deleteLibraryItem(userId: string, id: string): boolean {
  const res = db()
    .prepare("DELETE FROM library_items WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return Number(res.changes) > 0;
}

export function libraryStats(userId: string) {
  const rows = db()
    .prepare(
      `SELECT folder, COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes
       FROM library_items WHERE user_id = ? GROUP BY folder`,
    )
    .all(userId) as { folder: string; count: number; bytes: number }[];

  const byFolder: Record<string, { count: number; bytes: number }> = {};
  let total = 0;
  let bytes = 0;
  for (const r of rows) {
    byFolder[r.folder] = { count: Number(r.count), bytes: Number(r.bytes) };
    total += Number(r.count);
    bytes += Number(r.bytes);
  }
  return { byFolder, total, bytes };
}
