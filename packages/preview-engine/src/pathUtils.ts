import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function stripViteFsPrefix(filePath: string) {
  return filePath.startsWith("/@fs/") ? filePath.slice("/@fs/".length) : filePath;
}

function normalizeComparablePath(filePath: string) {
  const slashNormalizedPath = filePath.replace(/\\/g, "/");
  return ts.sys.useCaseSensitiveFileNames ? slashNormalizedPath : slashNormalizedPath.toLowerCase();
}

function getComparablePathVariants(filePath: string) {
  const resolvedPath = normalizeComparablePath(resolveFilePath(filePath));
  const comparablePaths = new Set<string>([resolvedPath]);

  try {
    comparablePaths.add(
      normalizeComparablePath(
        fs.realpathSync.native?.(resolveFilePath(filePath)) ?? fs.realpathSync(resolveFilePath(filePath)),
      ),
    );
  } catch {
    // Keep the resolved path when the file no longer exists.
  }

  return [...comparablePaths];
}

export function stripFileIdDecorations(filePath: string) {
  const searchIndex = filePath.search(/[?#]/);
  return searchIndex === -1 ? filePath : filePath.slice(0, searchIndex);
}

export function resolveFilePath(filePath: string) {
  return path.resolve(stripViteFsPrefix(stripFileIdDecorations(filePath)));
}

export function resolveRealFilePath(filePath: string) {
  const resolvedPath = resolveFilePath(filePath);

  try {
    return fs.realpathSync.native?.(resolvedPath) ?? fs.realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function canonicalizeFilePath(filePath: string) {
  return getComparablePathVariants(filePath)[0]!;
}

export function isFilePathUnderRoot(rootPath: string, filePath: string) {
  const comparableRootPaths = getComparablePathVariants(rootPath);
  const comparableFilePaths = getComparablePathVariants(filePath);

  return comparableFilePaths.some((comparableFilePath) =>
    comparableRootPaths.some((comparableRootPath) => {
      if (comparableFilePath === comparableRootPath) {
        return true;
      }

      const rootPrefix = comparableRootPath.endsWith("/") ? comparableRootPath : `${comparableRootPath}/`;
      return comparableFilePath.startsWith(rootPrefix);
    }),
  );
}
