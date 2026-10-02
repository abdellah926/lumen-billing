import "server-only";

import path from "node:path";

/**
 * Where everything this app writes lives: the SQLite file, original media, and
 * the resized image derivatives.
 *
 * `LUMEN_DATA_DIR` exists so a deploy can put media on a different volume than
 * the code, and so tests can point at a scratch directory.
 */
export const DATA_DIR = process.env.LUMEN_DATA_DIR ?? path.join(process.cwd(), "data");
