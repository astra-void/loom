import path from "node:path";
import ts from "typescript";
import type { Plugin } from "vite";

export const UNRESOLVED_MOCK_MODULE_ID = "virtual:lattice-preview-unresolved-env";
const RESOLVED_UNRESOLVED_MOCK_MODULE_ID = `\0${UNRESOLVED_MOCK_MODULE_ID}`;
const SCRIPT_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const DEFAULT_MOCK_IMPORT_BASENAME = "__latticeUnresolvedEnvMock";
const MODULE_MOCK_IMPORT_BASENAME = "__latticeUnresolvedModuleMock";
const UNSUPPORTED_RESOLVED_EXTENSIONS = new Set([".lua", ".luau"]);
function normalizeResolvedId(id: string) {
  return stripQuery(id)
    .split("#", 1)[0]!
    .replace(/^\/@id\/__x00__/, "\0");
}

function isMockResolvedId(id: string) {
  const normalizedId = normalizeResolvedId(id);
  return normalizedId === UNRESOLVED_MOCK_MODULE_ID || normalizedId === RESOLVED_UNRESOLVED_MOCK_MODULE_ID;
}

export const ROBLOX_MOCK_MODULE_ID = UNRESOLVED_MOCK_MODULE_ID;

export type TransformResolveContext = {
  resolve?: (source: string, importer?: string, options?: { skipSelf?: boolean }) => Promise<unknown> | unknown;
};

function stripQuery(id: string) {
  const [filePath] = id.split("?", 1);
  return filePath;
}

function getResolvedId(resolved: unknown) {
  if (typeof resolved === "string") {
    return resolved;
  }

  if (typeof resolved === "object" && resolved !== null && "id" in resolved) {
    const candidate = (resolved as { id?: unknown }).id;
    return typeof candidate === "string" ? candidate : undefined;
  }

  return undefined;
}

function isUnsupportedResolvedId(id: string) {
  if (id.startsWith("\0")) {
    return false;
  }

  const normalizedId = normalizeResolvedId(id).replace(/\\/g, "/").toLowerCase();
  if (normalizedId.endsWith(".d.ts") || normalizedId.endsWith(".d.mts") || normalizedId.endsWith(".d.cts")) {
    return true;
  }

  const extension = path.posix.extname(normalizedId);
  return UNSUPPORTED_RESOLVED_EXTENSIONS.has(extension);
}

function isAbsoluteFileSpecifier(specifier: string) {
  return /^[A-Za-z]:[\\/]/.test(specifier);
}

function hasUriScheme(specifier: string) {
  return /^[A-Za-z][A-Za-z+.-]*:/.test(specifier);
}

export function isBareModuleSpecifier(specifier: string) {
  return !(
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("\\") ||
    specifier.startsWith("\0") ||
    isAbsoluteFileSpecifier(specifier) ||
    hasUriScheme(specifier)
  );
}

async function shouldMockSpecifier(context: TransformResolveContext, specifier: string, importer: string) {
  if (!isBareModuleSpecifier(specifier) || specifier === UNRESOLVED_MOCK_MODULE_ID) {
    return false;
  }

  try {
    const resolved = await context.resolve?.(specifier, importer, { skipSelf: true });
    const resolvedId = getResolvedId(resolved);
    return resolvedId == null || isMockResolvedId(resolvedId) || isUnsupportedResolvedId(resolvedId);
  } catch {
    return true;
  }
}

function detectScriptKind(filePath: string) {
  const normalizedPath = filePath.toLowerCase();

  if (normalizedPath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (normalizedPath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (normalizedPath.endsWith(".js") || normalizedPath.endsWith(".mjs") || normalizedPath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

function createUniqueLocalName(sourceText: string, baseName: string) {
  let candidate = baseName;
  let suffix = 0;

  while (sourceText.includes(candidate)) {
    suffix += 1;
    candidate = `${baseName}${suffix}`;
  }

  return candidate;
}

function createMockImportDeclaration(
  mockModuleId: string,
  defaultLocalName?: string,
  namedImports: Array<{ imported: string; local: string }> = [],
) {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      defaultLocalName ? ts.factory.createIdentifier(defaultLocalName) : undefined,
      namedImports.length > 0
        ? ts.factory.createNamedImports(
            namedImports.map(({ imported, local }) =>
              ts.factory.createImportSpecifier(
                false,
                imported === local ? undefined : ts.factory.createIdentifier(imported),
                ts.factory.createIdentifier(local),
              ),
            ),
          )
        : undefined,
    ),
    ts.factory.createStringLiteral(mockModuleId),
    undefined,
  );
}

function createConstAlias(localName: string, initializer: ts.Expression) {
  return ts.factory.createVariableStatement(
    undefined,
    ts.factory.createVariableDeclarationList(
      [ts.factory.createVariableDeclaration(ts.factory.createIdentifier(localName), undefined, undefined, initializer)],
      ts.NodeFlags.Const,
    ),
  );
}

function createExportedConst(localName: string, initializer: ts.Expression) {
  return ts.factory.createVariableStatement(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createVariableDeclarationList(
      [ts.factory.createVariableDeclaration(ts.factory.createIdentifier(localName), undefined, undefined, initializer)],
      ts.NodeFlags.Const,
    ),
  );
}

function createValueAccessExpression(mockIdentifier: string, memberName: string) {
  return memberName === "default"
    ? ts.factory.createIdentifier(mockIdentifier)
    : ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(mockIdentifier), memberName);
}

function collectCandidateSpecifiers(sourceFile: ts.SourceFile) {
  const candidates = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      candidates.add(node.moduleSpecifier.text);
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      candidates.add(node.moduleSpecifier.text);
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      candidates.add(node.moduleReference.expression.text);
    }

    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
          candidates.add(argument.text);
        }

        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          candidates.add(argument.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return candidates;
}

function rewriteExpressionLevelLoads<T extends ts.Node>(
  node: T,
  moduleMockLocalName: string,
  shouldMock: (specifier: string) => boolean,
  onRewrite: () => void,
) {
  const result = ts.transform(node, [
    (context) => {
      const visit: ts.Visitor = (currentNode) => {
        if (ts.isCallExpression(currentNode) && currentNode.arguments.length === 1) {
          const [argument] = currentNode.arguments;

          if (argument && ts.isStringLiteral(argument) && shouldMock(argument.text)) {
            if (ts.isIdentifier(currentNode.expression) && currentNode.expression.text === "require") {
              onRewrite();
              return ts.factory.createIdentifier(moduleMockLocalName);
            }

            if (currentNode.expression.kind === ts.SyntaxKind.ImportKeyword) {
              onRewrite();
              return ts.factory.createCallExpression(
                ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("Promise"), "resolve"),
                undefined,
                [ts.factory.createIdentifier(moduleMockLocalName)],
              );
            }
          }
        }

        return ts.visitEachChild(currentNode, visit, context);
      };

      return (sourceNode) => ts.visitNode(sourceNode, visit) as T;
    },
  ]);

  const transformed = result.transformed[0];
  result.dispose();
  return transformed;
}

export function createUnresolvedPackageMockResolvePlugin(mockEntryPath: string): Plugin {
  return {
    name: "lattice-preview-unresolved-package-mock-resolve",
    enforce: "pre",
    async load(id) {
      if (id !== RESOLVED_UNRESOLVED_MOCK_MODULE_ID) {
        return undefined;
      }

      return {
        code: `
import mock, { robloxModuleMock } from ${JSON.stringify(mockEntryPath)};
export const __syntheticNamedExports = robloxModuleMock;
export { robloxModuleMock };
export default mock;
`.trim(),
        syntheticNamedExports: "__syntheticNamedExports",
      };
    },
    async resolveId(id, importer, options) {
      if (id === UNRESOLVED_MOCK_MODULE_ID) {
        return RESOLVED_UNRESOLVED_MOCK_MODULE_ID;
      }

      if (!isBareModuleSpecifier(id)) {
        return undefined;
      }

      try {
        const resolved = await this.resolve(id, importer, { ...(options ?? {}), skipSelf: true });
        const resolvedId = getResolvedId(resolved);
        return resolvedId == null || isUnsupportedResolvedId(resolvedId)
          ? RESOLVED_UNRESOLVED_MOCK_MODULE_ID
          : undefined;
      } catch {
        return RESOLVED_UNRESOLVED_MOCK_MODULE_ID;
      }
    },
  };
}

export function createUnresolvedPackageMockTransformPlugin(): Plugin {
  return {
    name: "lattice-preview-unresolved-package-mock-transform",
    enforce: "pre",
    async transform(this: TransformResolveContext, code, id) {
      const filePath = stripQuery(id);
      if (!SCRIPT_FILE_PATTERN.test(filePath) || !/(?:import|export|require\s*\(|import\s*\()/.test(code)) {
        return undefined;
      }

      const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, detectScriptKind(filePath));
      const specifiers = [...collectCandidateSpecifiers(sourceFile)];
      if (specifiers.length === 0) {
        return undefined;
      }

      const mockedSpecifiers = new Set<string>();
      for (const specifier of specifiers) {
        if (await shouldMockSpecifier(this, specifier, filePath)) {
          mockedSpecifiers.add(specifier);
        }
      }

      if (mockedSpecifiers.size === 0) {
        return undefined;
      }

      const shouldMock = (specifier: string) => mockedSpecifiers.has(specifier);
      const mockLocalName = createUniqueLocalName(code, DEFAULT_MOCK_IMPORT_BASENAME);
      const moduleMockLocalName = createUniqueLocalName(code, MODULE_MOCK_IMPORT_BASENAME);
      const rewrittenStatements: ts.Statement[] = [];
      let transformed = false;
      let needsDefaultMockImport = false;
      let needsModuleMockImport = false;

      for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          const moduleSpecifier = statement.moduleSpecifier.text;
          if (!shouldMock(moduleSpecifier)) {
            rewrittenStatements.push(statement);
            continue;
          }

          transformed = true;
          const importClause = statement.importClause;

          if (!importClause || importClause.isTypeOnly) {
            continue;
          }

          if (importClause.name) {
            needsDefaultMockImport = true;
            rewrittenStatements.push(
              createConstAlias(importClause.name.text, ts.factory.createIdentifier(mockLocalName)),
            );
          }

          const namedBindings = importClause.namedBindings;
          if (!namedBindings) {
            continue;
          }

          if (ts.isNamespaceImport(namedBindings)) {
            needsDefaultMockImport = true;
            rewrittenStatements.push(
              createConstAlias(namedBindings.name.text, ts.factory.createIdentifier(mockLocalName)),
            );
            continue;
          }

          for (const element of namedBindings.elements) {
            if (element.isTypeOnly) {
              continue;
            }

            needsDefaultMockImport = true;
            const importedName = element.propertyName?.text ?? element.name.text;
            rewrittenStatements.push(
              createConstAlias(element.name.text, createValueAccessExpression(mockLocalName, importedName)),
            );
          }

          continue;
        }

        if (ts.isImportEqualsDeclaration(statement)) {
          const moduleReference = statement.moduleReference;
          if (
            !ts.isExternalModuleReference(moduleReference) ||
            !moduleReference.expression ||
            !ts.isStringLiteral(moduleReference.expression) ||
            !shouldMock(moduleReference.expression.text)
          ) {
            rewrittenStatements.push(statement);
            continue;
          }

          transformed = true;
          needsModuleMockImport = true;
          rewrittenStatements.push(
            createConstAlias(statement.name.text, ts.factory.createIdentifier(moduleMockLocalName)),
          );
          continue;
        }

        if (
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          const moduleSpecifier = statement.moduleSpecifier.text;
          if (!shouldMock(moduleSpecifier)) {
            rewrittenStatements.push(statement);
            continue;
          }

          transformed = true;
          if (statement.isTypeOnly) {
            continue;
          }

          if (!statement.exportClause) {
            rewrittenStatements.push(
              ts.factory.createExportDeclaration(
                statement.modifiers,
                false,
                undefined,
                ts.factory.createStringLiteral(UNRESOLVED_MOCK_MODULE_ID),
                statement.attributes,
              ),
            );
            continue;
          }

          if (ts.isNamespaceExport(statement.exportClause)) {
            needsDefaultMockImport = true;
            rewrittenStatements.push(
              createExportedConst(statement.exportClause.name.text, ts.factory.createIdentifier(mockLocalName)),
            );
            continue;
          }

          for (const element of statement.exportClause.elements) {
            if (element.isTypeOnly) {
              continue;
            }

            needsDefaultMockImport = true;
            const importedName = element.propertyName?.text ?? element.name.text;
            const exportedName = element.name.text;
            const initializer = createValueAccessExpression(mockLocalName, importedName);

            if (exportedName === "default") {
              rewrittenStatements.push(ts.factory.createExportAssignment(undefined, false, initializer));
              continue;
            }

            rewrittenStatements.push(createExportedConst(exportedName, initializer));
          }

          continue;
        }

        const rewrittenStatement = rewriteExpressionLevelLoads(statement, moduleMockLocalName, shouldMock, () => {
          transformed = true;
          needsModuleMockImport = true;
        });

        rewrittenStatements.push(rewrittenStatement);
      }

      if (!transformed) {
        return undefined;
      }

      const importSpecifiers = needsModuleMockImport
        ? [{ imported: "robloxModuleMock", local: moduleMockLocalName }]
        : [];

      if (needsDefaultMockImport || needsModuleMockImport) {
        rewrittenStatements.unshift(
          createMockImportDeclaration(
            UNRESOLVED_MOCK_MODULE_ID,
            needsDefaultMockImport ? mockLocalName : undefined,
            importSpecifiers,
          ),
        );
      }

      const printer = ts.createPrinter({
        newLine: ts.NewLineKind.LineFeed,
      });

      return {
        code: printer.printFile(
          ts.factory.updateSourceFile(sourceFile, ts.factory.createNodeArray(rewrittenStatements)),
        ),
        map: null,
      };
    },
  };
}

export const createRobloxPackageMockResolvePlugin = createUnresolvedPackageMockResolvePlugin;
export const createRobloxPackageMockTransformPlugin = createUnresolvedPackageMockTransformPlugin;
