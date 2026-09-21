// scripts/ts-resolve-hook.mjs
//
// Node's type stripping requires explicit file extensions, while this repo
// imports its TypeScript modules extensionless (the way Next.js resolves them).
// This resolver hook appends the extension for relative imports so the test
// scripts can exercise the real application modules without altering them.

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[cm]?[jt]sx?$/i.test(specifier);
  if (isRelative && !hasExtension) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      try {
        return await nextResolve(`${specifier}/index.ts`, context);
      } catch {
        /* fall through to the default resolution */
      }
    }
  }
  return nextResolve(specifier, context);
}
