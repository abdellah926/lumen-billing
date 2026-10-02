import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Node module hooks that make the app's modules importable outside Next.js.
 *
 * Two things stand between `src/lib/billing/*.ts` and a plain `node` process:
 *
 * 1. The `@/` path alias, which is resolved here against the real source tree.
 * 2. The `server-only` marker package, whose default export throws outside a React Server
 *    Component graph. It is a build-time guard, not behaviour worth testing, so it is
 *    mapped to an empty module.
 *
 * Sources are transpiled with the project's own TypeScript rather than Node's strip-only
 * mode, because strip-only rejects parameter properties (`constructor(readonly x: number)`)
 * and this codebase uses them throughout, including in `ApiError`. Matching the real
 * compiler means the test exercises the code as it is actually built.
 */

const require = createRequire(import.meta.url);
const ts = require("typescript");

const SRC = pathToFileURL(path.resolve(process.cwd(), "src") + path.sep).href;
const NEXT_PKG = path.resolve(process.cwd(), "node_modules", "next");

/**
 * `next/headers` and friends are not listed in next's `exports` map. They resolve only by the
 * legacy convention of a file sitting at the package root, which Node's ESM resolver does not
 * apply to bare specifiers, so importing one here fails with ERR_MODULE_NOT_FOUND. Next's own
 * bundler copes; plain Node does not. These are mapped to the real files instead, so tests
 * exercise the shipped implementation rather than a stand-in.
 */
function legacyNextSubpath(specifier) {
  const rest = specifier.slice("next/".length);
  if (!/^[\w./-]+$/.test(rest) || rest.includes("..")) return null;
  const base = path.join(NEXT_PKG, rest);
  for (const candidate of [`${base}.js`, path.join(base, "index.js")]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export{}", shortCircuit: true, format: "module" };
  }

  if (specifier.startsWith("next/")) {
    const legacy = legacyNextSubpath(specifier);
    if (legacy) return nextResolve(legacy, context);
    return nextResolve(specifier, context);
  }

  if (specifier.startsWith("@/")) {
    const url = new URL(specifier.slice(2), SRC);
    if (!/\.(ts|tsx|js|mjs|json)$/.test(url.pathname)) {
      return nextResolve(new URL(url.href + ".ts").href, context);
    }
    return nextResolve(url.href, context);
  }

  // Extensionless relative imports (`./db`) are what TypeScript and Turbopack accept but Node's
  // ESM resolver rejects. Try the extensions this project actually uses, then the directory index.
  if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) && context.parentURL) {
    const candidate = await firstExisting(
      new URL(specifier, context.parentURL),
      [".ts", ".tsx", ".js", ".mjs"],
    );
    if (candidate) return nextResolve(candidate, context);
  }

  return nextResolve(specifier, context);
}

async function firstExisting(url, extensions) {
  for (const ext of extensions) {
    const withExt = new URL(url.href + ext);
    if (existsSync(fileURLToPath(withExt))) return withExt.href;
  }
  for (const ext of extensions) {
    const asIndex = new URL(`${url.href.replace(/\/$/, "")}/index${ext}`);
    if (existsSync(fileURLToPath(asIndex))) return asIndex.href;
  }
  return null;
}

export async function load(url, context, nextLoad) {
  if (!/\.(ts|tsx)$/.test(url)) return nextLoad(url, context);

  const filename = fileURLToPath(url);
  const source = await readFile(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
      isolatedModules: true,
    },
  });

  return { format: "module", source: outputText, shortCircuit: true };
}
