import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isFilePathUnderRoot, resolveRealFilePath } from "./pathUtils";
import type {
  CreatePreviewEngineOptions,
  PreviewDiagnostic,
  PreviewDiscoveryDiagnosticCode,
  PreviewEntryDescriptor,
  PreviewEntryStatus,
  PreviewEntryStatusDetails,
  PreviewGraphImportEdge,
  PreviewGraphTrace,
  PreviewRenderTarget,
  PreviewSelection,
  PreviewSourceTarget,
  PreviewWorkspaceIndex,
} from "./types";
import { PREVIEW_ENGINE_PROTOCOL_VERSION } from "./types";
import {
  createWorkspaceGraphService,
  isTransformableSourceFile,
  type WorkspaceGraphService,
  type WorkspaceProject,
} from "./workspaceGraph";

const PREVIEW_PACKAGE_ENTRY_EXCLUDES = ["runtime/", "shell/"];

type PreviewExportInfo = {
  entryLocalName?: string;
  hasEntry: boolean;
  hasExport: boolean;
  hasProps: boolean;
  hasRender: boolean;
  title?: string;
};

type LocalRenderableDeclarationKind =
  | "function-declaration"
  | "variable-arrow"
  | "variable-function"
  | "variable-other";

type LocalRenderableMetadata = {
  declarationKind: LocalRenderableDeclarationKind;
  isRenderable: boolean;
  matchesFileBasename: boolean;
  name: string;
};

type ImportBinding = {
  importedName: "default" | string;
  sourceFilePath: string;
};

type ExportBinding =
  | {
      kind: "default-expression";
    }
  | {
      kind: "local";
      localName: string;
    }
  | {
      importedName: "default" | string;
      kind: "re-export";
      sourceFilePath: string;
    };

type RawDiagnostic = Omit<PreviewDiagnostic, "entryId" | "relativeFile"> & {
  packageRoot: string;
};

type TargetContext = {
  packageName: string;
  packageRoot: string;
  sourceRoot: string;
  targetName: string;
  workspaceRoot: string;
};

type RawSourceModuleRecord = {
  exportAllSources: string[];
  exportBindings: Map<string, ExportBinding[]>;
  filePath: string;
  graphEdges: PreviewGraphImportEdge[];
  importBindings: Map<string, ImportBinding>;
  imports: string[];
  isTsx: boolean;
  localRenderableMetadata: Map<string, LocalRenderableMetadata>;
  ownerPackageName?: string;
  ownerPackageRoot: string;
  project?: WorkspaceProject;
  preview: PreviewExportInfo;
  previewExported: boolean;
  rawDiagnostics: RawDiagnostic[];
  relativePath: string;
  target: TargetContext;
};

type ResolvedRenderableRef = {
  importChain: string[];
  originFilePath: string;
  symbolChain: string[];
  symbolName: string;
};

export type DiscoveredEntryState = {
  dependencyPaths: string[];
  descriptor: PreviewEntryDescriptor;
  discoveryDiagnostics: PreviewDiagnostic[];
  graphTrace: PreviewGraphTrace;
  packageRoot: string;
  previewHasProps: boolean;
  target: TargetContext;
};

export type WorkspaceDiscoverySnapshot = {
  entryDependencyPathsById: Map<string, string[]>;
  entryStatesById: Map<string, DiscoveredEntryState>;
  workspaceIndex: PreviewWorkspaceIndex;
};

function toRelativePath(rootPath: string, filePath: string) {
  return path.relative(resolveRealFilePath(rootPath), resolveRealFilePath(filePath)).split(path.sep).join("/");
}

function humanizeTitle(relativePath: string) {
  const baseName = path.basename(relativePath, path.extname(relativePath));
  return baseName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function isExported(node: ts.Node) {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function isDefaultExport(node: ts.Node) {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) !== 0;
}

function isComponentName(name: string) {
  return /^[A-Z]/.test(name);
}

function isRenderableInitializer(initializer: ts.Expression | undefined) {
  return Boolean(initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)));
}

function getVariableDeclarationKind(initializer: ts.Expression | undefined): LocalRenderableDeclarationKind {
  if (initializer && ts.isArrowFunction(initializer)) {
    return "variable-arrow";
  }

  if (initializer && ts.isFunctionExpression(initializer)) {
    return "variable-function";
  }

  return "variable-other";
}

function getPropertyNameText(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function parsePreviewObject(node: ts.Expression | undefined): PreviewExportInfo | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    return undefined;
  }

  let entryLocalName: string | undefined;
  let title: string | undefined;
  let hasProps = false;
  let hasRender = false;

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      continue;
    }

    const propertyName = getPropertyNameText(property.name);
    if (!propertyName) {
      continue;
    }

    if (propertyName === "title" && ts.isPropertyAssignment(property)) {
      const initializer = property.initializer;
      if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
        title = initializer.text;
      }
      continue;
    }

    if (propertyName === "props") {
      hasProps = true;
      continue;
    }

    if (propertyName === "entry" && ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) {
      entryLocalName = property.initializer.text;
      continue;
    }

    if (propertyName === "render") {
      hasRender = true;
    }
  }

  return {
    entryLocalName,
    hasEntry: entryLocalName !== undefined,
    hasExport: true,
    hasProps,
    hasRender,
    title,
  };
}

function findWorkspaceRoot(startPath: string | string[]) {
  const startPaths = Array.isArray(startPath) ? startPath : [startPath];
  const resolvedStartPaths = startPaths.map((candidate) => resolveRealFilePath(candidate));
  const markerRoots = resolvedStartPaths.map((candidate) => {
    let current = candidate;

    while (true) {
      if (fs.existsSync(path.join(current, "pnpm-workspace.yaml")) || fs.existsSync(path.join(current, ".git"))) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return candidate;
      }

      current = parent;
    }
  });

  let commonPath = markerRoots[0] ?? process.cwd();
  for (const candidate of markerRoots.slice(1)) {
    while (!isFilePathUnderRoot(commonPath, candidate)) {
      const parent = path.dirname(commonPath);
      if (parent === commonPath) {
        return commonPath;
      }

      commonPath = parent;
    }
  }

  return commonPath;
}

function findNearestPackageRoot(filePath: string) {
  let current = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath);

  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return resolveRealFilePath(current);
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return resolveRealFilePath(path.dirname(filePath));
    }

    current = parent;
  }
}

function collectLocalRenderableNames(sourceFile: ts.SourceFile) {
  const fileBasename = path.basename(sourceFile.fileName, path.extname(sourceFile.fileName));
  const localRenderableMetadata = new Map<string, LocalRenderableMetadata>();
  let localPreviewInfo: PreviewExportInfo | undefined;

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isComponentName(statement.name.text)) {
      localRenderableMetadata.set(statement.name.text, {
        declarationKind: "function-declaration",
        isRenderable: true,
        matchesFileBasename: statement.name.text === fileBasename,
        name: statement.name.text,
      });
      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }

      if (declaration.name.text === "preview") {
        localPreviewInfo = parsePreviewObject(declaration.initializer) ?? localPreviewInfo;
      }

      if (isComponentName(declaration.name.text)) {
        localRenderableMetadata.set(declaration.name.text, {
          declarationKind: getVariableDeclarationKind(declaration.initializer),
          isRenderable: isRenderableInitializer(declaration.initializer),
          matchesFileBasename: declaration.name.text === fileBasename,
          name: declaration.name.text,
        });
      }
    }
  }

  return {
    localPreviewInfo,
    localRenderableMetadata,
  };
}

function parseModuleRecord(
  filePath: string,
  target: TargetContext,
  graphService: WorkspaceGraphService,
): RawSourceModuleRecord {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const { localPreviewInfo, localRenderableMetadata } = collectLocalRenderableNames(sourceFile);
  const fileContext = graphService.getFileContext(filePath);
  const importBindings = new Map<string, ImportBinding>();
  const exportBindings = new Map<string, ExportBinding[]>();
  const exportAllSources: string[] = [];
  const graphEdges: PreviewGraphImportEdge[] = [];
  const imports = new Set<string>();
  const rawDiagnostics = new Map<string, RawDiagnostic>();
  let previewExported = false;
  let preview = localPreviewInfo;

  const addDiagnostic = (diagnostic: RawDiagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.file}:${diagnostic.summary}`;
    rawDiagnostics.set(key, diagnostic);
  };

  const addExportBinding = (exportName: string, binding: ExportBinding) => {
    const bindings = exportBindings.get(exportName) ?? [];
    bindings.push(binding);
    exportBindings.set(exportName, bindings);
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const resolvedImport = graphService.resolveImport({
        importerFilePath: filePath,
        specifier: statement.moduleSpecifier.text,
      });

      if (resolvedImport?.edge) {
        graphEdges.push(resolvedImport.edge);
      }

      if (resolvedImport?.diagnostic) {
        addDiagnostic({
          ...resolvedImport.diagnostic,
        });
      }

      if (resolvedImport?.followedFilePath) {
        imports.add(resolvedImport.followedFilePath);
        const clause = statement.importClause;
        if (clause?.name) {
          importBindings.set(clause.name.text, {
            importedName: "default",
            sourceFilePath: resolvedImport.followedFilePath,
          });
        }

        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            importBindings.set(element.name.text, {
              importedName: element.propertyName?.text ?? element.name.text,
              sourceFilePath: resolvedImport.followedFilePath,
            });
          }
        }
      }

      continue;
    }

    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      if (statement.name?.text === "preview") {
        previewExported = true;
      } else if (statement.name) {
        addExportBinding(isDefaultExport(statement) ? "default" : statement.name.text, {
          kind: "local",
          localName: statement.name.text,
        });
      } else if (isDefaultExport(statement)) {
        addExportBinding("default", { kind: "default-expression" });
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }

        if (declaration.name.text === "preview" && isExported(statement)) {
          previewExported = true;
          preview = parsePreviewObject(declaration.initializer) ??
            preview ?? {
              hasEntry: false,
              hasExport: true,
              hasProps: false,
              hasRender: false,
            };
          continue;
        }

        if (!isExported(statement)) {
          continue;
        }

        addExportBinding(isDefaultExport(statement) ? "default" : declaration.name.text, {
          kind: "local",
          localName: declaration.name.text,
        });
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        addExportBinding("default", {
          kind: "local",
          localName: statement.expression.text,
        });
      } else if (ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression)) {
        addExportBinding("default", { kind: "default-expression" });
      }
      continue;
    }

    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || !statement.moduleSpecifier) {
      if (
        ts.isExportDeclaration(statement) &&
        !statement.isTypeOnly &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text;
          const exportName = element.name.text;
          if (localName === "preview") {
            previewExported = true;
            continue;
          }

          addExportBinding(exportName, {
            kind: "local",
            localName,
          });
        }
      }
      continue;
    }

    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const resolvedImport = graphService.resolveImport({
      importerFilePath: filePath,
      specifier: statement.moduleSpecifier.text,
    });

    if (resolvedImport?.edge) {
      graphEdges.push(resolvedImport.edge);
    }

    if (resolvedImport?.diagnostic) {
      addDiagnostic({
        ...resolvedImport.diagnostic,
      });
    }

    if (!resolvedImport?.followedFilePath) {
      continue;
    }

    imports.add(resolvedImport.followedFilePath);

    if (!statement.exportClause) {
      exportAllSources.push(resolvedImport.followedFilePath);
      continue;
    }

    if (!ts.isNamedExports(statement.exportClause)) {
      continue;
    }

    for (const element of statement.exportClause.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      const exportName = element.name.text;
      if (importedName === "preview") {
        previewExported = true;
        continue;
      }

      addExportBinding(exportName, {
        importedName,
        kind: "re-export",
        sourceFilePath: resolvedImport.followedFilePath,
      });
    }
  }

  return {
    exportAllSources,
    exportBindings,
    filePath,
    graphEdges,
    importBindings,
    imports: [...imports].sort((left, right) => left.localeCompare(right)),
    isTsx: filePath.endsWith(".tsx") && isTransformableSourceFile(filePath),
    localRenderableMetadata,
    ownerPackageName: fileContext.packageName,
    ownerPackageRoot: fileContext.packageRoot,
    project: fileContext.project,
    preview: previewExported
      ? (preview ?? { hasEntry: false, hasExport: true, hasProps: false, hasRender: false })
      : { hasEntry: false, hasExport: false, hasProps: false, hasRender: false },
    previewExported,
    rawDiagnostics: [...rawDiagnostics.values()],
    relativePath: toRelativePath(target.sourceRoot, filePath),
    target,
  };
}

function resolveLocalReference(
  record: RawSourceModuleRecord,
  localName: string,
  recordsByPath: Map<string, RawSourceModuleRecord>,
  stack = new Set<string>(),
): ResolvedRenderableRef | undefined {
  const localMetadata = record.localRenderableMetadata.get(localName);
  if (localMetadata?.isRenderable) {
    return {
      importChain: [record.filePath],
      originFilePath: record.filePath,
      symbolChain: [`${record.filePath}#${localName}`],
      symbolName: localName,
    };
  }

  const importBinding = record.importBindings.get(localName);
  if (!importBinding) {
    return undefined;
  }

  const sourceRecord = recordsByPath.get(importBinding.sourceFilePath);
  if (!sourceRecord) {
    return undefined;
  }

  const resolved = resolveExportReference(sourceRecord, importBinding.importedName, recordsByPath, stack);
  if (!resolved) {
    return undefined;
  }

  return {
    importChain: [record.filePath, ...resolved.importChain],
    originFilePath: resolved.originFilePath,
    symbolChain: [`${record.filePath}#${localName}`, ...resolved.symbolChain],
    symbolName: resolved.symbolName,
  };
}

function resolveExportReference(
  record: RawSourceModuleRecord,
  exportName: string,
  recordsByPath: Map<string, RawSourceModuleRecord>,
  stack = new Set<string>(),
): ResolvedRenderableRef | undefined {
  const stackKey = `${record.filePath}:${exportName}`;
  if (stack.has(stackKey)) {
    return undefined;
  }

  stack.add(stackKey);

  const bindings = record.exportBindings.get(exportName) ?? [];
  for (const binding of bindings) {
    if (binding.kind === "default-expression") {
      stack.delete(stackKey);
      return {
        importChain: [record.filePath],
        originFilePath: record.filePath,
        symbolChain: [`${record.filePath}#default`],
        symbolName: "default",
      };
    }

    if (binding.kind === "local") {
      const resolved = resolveLocalReference(record, binding.localName, recordsByPath, stack);
      if (resolved) {
        stack.delete(stackKey);
        return {
          ...resolved,
          symbolChain: [`${record.filePath}#${exportName}`, ...resolved.symbolChain],
        };
      }
      continue;
    }

    const sourceRecord = recordsByPath.get(binding.sourceFilePath);
    if (!sourceRecord) {
      continue;
    }

    const resolved = resolveExportReference(sourceRecord, binding.importedName, recordsByPath, stack);
    if (resolved) {
      stack.delete(stackKey);
      return {
        importChain: [record.filePath, ...resolved.importChain],
        originFilePath: resolved.originFilePath,
        symbolChain: [`${record.filePath}#${exportName}`, ...resolved.symbolChain],
        symbolName: resolved.symbolName,
      };
    }
  }

  if (exportName !== "default") {
    for (const sourceFilePath of record.exportAllSources) {
      const sourceRecord = recordsByPath.get(sourceFilePath);
      if (!sourceRecord) {
        continue;
      }

      const resolved = resolveExportReference(sourceRecord, exportName, recordsByPath, stack);
      if (resolved) {
        stack.delete(stackKey);
        return {
          importChain: [record.filePath, ...resolved.importChain],
          originFilePath: resolved.originFilePath,
          symbolChain: [`${record.filePath}#${exportName}`, ...resolved.symbolChain],
          symbolName: resolved.symbolName,
        };
      }
    }
  }

  stack.delete(stackKey);
  return undefined;
}

function getRenderableNamedExports(record: RawSourceModuleRecord, recordsByPath: Map<string, RawSourceModuleRecord>) {
  const renderableExports = new Set<string>();
  for (const exportName of record.exportBindings.keys()) {
    if (exportName === "default" || exportName === "preview") {
      continue;
    }

    if (resolveExportReference(record, exportName, recordsByPath)) {
      renderableExports.add(exportName);
    }
  }

  for (const sourceFilePath of record.exportAllSources) {
    const sourceRecord = recordsByPath.get(sourceFilePath);
    if (!sourceRecord) {
      continue;
    }

    for (const exportName of getRenderableNamedExports(sourceRecord, recordsByPath)) {
      renderableExports.add(exportName);
    }
  }

  return [...renderableExports].sort((left, right) => left.localeCompare(right));
}

function hasRenderableDefaultExport(record: RawSourceModuleRecord, recordsByPath: Map<string, RawSourceModuleRecord>) {
  return resolveExportReference(record, "default", recordsByPath) !== undefined;
}

function resolvePreviewEntryExport(record: RawSourceModuleRecord, recordsByPath: Map<string, RawSourceModuleRecord>) {
  const entryLocalName = record.preview.entryLocalName;
  if (!entryLocalName) {
    return undefined;
  }

  const resolvedEntry = resolveLocalReference(record, entryLocalName, recordsByPath);
  if (!resolvedEntry) {
    return undefined;
  }

  const exportNames: string[] = [];
  const candidates = record.exportBindings.has("default")
    ? ["default", ...getRenderableNamedExports(record, recordsByPath)]
    : getRenderableNamedExports(record, recordsByPath);

  for (const exportName of candidates) {
    const resolvedExport = resolveExportReference(record, exportName, recordsByPath);
    if (
      resolvedExport &&
      resolvedExport.originFilePath === resolvedEntry.originFilePath &&
      resolvedExport.symbolName === resolvedEntry.symbolName
    ) {
      exportNames.push(exportName);
    }
  }

  if (exportNames.length === 0) {
    return undefined;
  }

  if (exportNames.includes(entryLocalName)) {
    return {
      exportName: entryLocalName,
      trace: resolvedEntry,
    };
  }

  if (exportNames.length === 1) {
    return {
      exportName: exportNames[0]!,
      trace: resolvedEntry,
    };
  }

  if (exportNames.includes("default")) {
    return {
      exportName: "default",
      trace: resolvedEntry,
    };
  }

  return {
    exportName: exportNames[0]!,
    trace: resolvedEntry,
  };
}

function collectTransitivePaths(
  filePath: string,
  recordsByPath: Map<string, RawSourceModuleRecord>,
  visited = new Set<string>(),
  collected: string[] = [],
) {
  if (visited.has(filePath)) {
    return collected;
  }

  visited.add(filePath);
  collected.push(filePath);

  const record = recordsByPath.get(filePath);
  if (!record) {
    return collected;
  }

  for (const importPath of record.imports) {
    collectTransitivePaths(importPath, recordsByPath, visited, collected);
  }

  return collected;
}

function collectTransitiveDiagnostics(
  entryId: string,
  filePath: string,
  recordsByPath: Map<string, RawSourceModuleRecord>,
  visited = new Set<string>(),
  diagnostics = new Map<string, PreviewDiagnostic>(),
) {
  if (visited.has(filePath)) {
    return diagnostics;
  }

  visited.add(filePath);
  const record = recordsByPath.get(filePath);
  if (!record) {
    return diagnostics;
  }

  for (const diagnostic of record.rawDiagnostics) {
    const nextDiagnostic: PreviewDiagnostic = {
      ...diagnostic,
      entryId,
      relativeFile: toRelativePath(diagnostic.packageRoot, diagnostic.file),
    };
    const key = `${nextDiagnostic.code}:${nextDiagnostic.file}:${nextDiagnostic.summary}`;
    diagnostics.set(key, nextDiagnostic);
  }

  for (const importPath of record.imports) {
    collectTransitiveDiagnostics(entryId, importPath, recordsByPath, visited, diagnostics);
  }

  return diagnostics;
}

function collectTransitiveGraphTrace(
  entryFilePath: string,
  recordsByPath: Map<string, RawSourceModuleRecord>,
  selectionTrace: PreviewGraphTrace["selection"],
) {
  const visited = new Set<string>();
  const imports = new Map<string, PreviewGraphImportEdge>();
  const boundaryHops = new Map<string, PreviewGraphTrace["boundaryHops"][number]>();
  const traversedProjects = new Map<string, NonNullable<PreviewGraphTrace["traversedProjects"]>[number]>();
  let stopReason: PreviewGraphTrace["stopReason"] | undefined;

  const visit = (filePath: string) => {
    if (visited.has(filePath)) {
      return;
    }

    visited.add(filePath);
    const record = recordsByPath.get(filePath);
    if (!record) {
      return;
    }

    if (record.project) {
      traversedProjects.set(record.project.configPath, {
        configPath: record.project.configPath,
        packageName: record.ownerPackageName,
        packageRoot: record.ownerPackageRoot,
      });
    }

    for (const edge of record.graphEdges) {
      const key = `${edge.importerFile}:${edge.specifier}:${edge.resolvedFile ?? edge.stopReason ?? "none"}`;
      imports.set(key, edge);
      if (!stopReason && edge.stopReason) {
        stopReason = edge.stopReason;
      }

      if (edge.crossesPackageBoundary && edge.resolvedFile) {
        const hop = {
          fromFile: edge.importerFile,
          fromPackageRoot: findNearestPackageRoot(edge.importerFile),
          toFile: edge.resolvedFile,
          toPackageRoot: findNearestPackageRoot(edge.resolvedFile),
        };
        boundaryHops.set(`${hop.fromFile}:${hop.toFile}`, hop);
      }
    }

    for (const importPath of record.imports) {
      visit(importPath);
    }
  };

  visit(entryFilePath);

  return {
    boundaryHops: [...boundaryHops.values()].sort((left, right) => left.toFile.localeCompare(right.toFile)),
    imports: [...imports.values()].sort((left, right) => {
      if (left.importerFile !== right.importerFile) {
        return left.importerFile.localeCompare(right.importerFile);
      }

      return left.specifier.localeCompare(right.specifier);
    }),
    selection: selectionTrace,
    ...(traversedProjects.size > 0
      ? {
          traversedProjects: [...traversedProjects.values()].sort((left, right) =>
            left.configPath.localeCompare(right.configPath),
          ),
        }
      : {}),
    ...(stopReason ? { stopReason } : {}),
  } satisfies PreviewGraphTrace;
}

function createEntryDiagnostic(
  code: PreviewDiscoveryDiagnosticCode,
  entryId: string,
  filePath: string,
  packageRoot: string,
  summary: string,
  severity: PreviewDiagnostic["severity"] = "warning",
) {
  return {
    code,
    entryId,
    file: filePath,
    phase: "discovery",
    relativeFile: toRelativePath(packageRoot, filePath),
    severity,
    summary,
    target: "preview-engine",
  } satisfies PreviewDiagnostic;
}

function createDiagnosticsSummary(diagnostics: PreviewDiagnostic[]) {
  const byPhase = {
    discovery: 0,
    layout: 0,
    runtime: 0,
    transform: 0,
  } satisfies Record<PreviewDiagnostic["phase"], number>;

  for (const diagnostic of diagnostics) {
    byPhase[diagnostic.phase] += 1;
  }

  return {
    byPhase,
    hasBlocking: diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    total: diagnostics.length,
  };
}

function createCapabilities(renderTarget: PreviewRenderTarget) {
  return {
    supportsHotUpdate: true,
    supportsLayoutDebug: true,
    supportsPropsEditing: renderTarget.kind === "component",
    supportsRuntimeMock: true,
  };
}

function createBaseStatusDetails(
  status: PreviewEntryStatus,
  renderTarget: PreviewRenderTarget,
): PreviewEntryStatusDetails {
  switch (status) {
    case "ambiguous":
      return {
        candidates: renderTarget.kind === "none" ? (renderTarget.candidates ?? []) : [],
        kind: "ambiguous",
        reason: "ambiguous-exports",
      };
    case "needs_harness":
      return {
        ...(renderTarget.kind === "none" && renderTarget.candidates ? { candidates: renderTarget.candidates } : {}),
        kind: "needs_harness",
        reason:
          renderTarget.kind === "none" && renderTarget.reason === "no-component-export"
            ? "no-component-export"
            : "missing-explicit-contract",
      };
    case "blocked_by_layout":
      return {
        issueCodes: [],
        kind: "blocked_by_layout",
        reason: "layout-issues",
      };
    case "blocked_by_runtime":
      return {
        issueCodes: [],
        kind: "blocked_by_runtime",
        reason: "runtime-issues",
      };
    case "blocked_by_transform":
      return {
        blockingCodes: [],
        kind: "blocked_by_transform",
        reason: "transform-diagnostics",
      };
    case "ready":
    default:
      return {
        kind: "ready",
      };
  }
}

function createExplicitSelection(record: RawSourceModuleRecord, recordsByPath: Map<string, RawSourceModuleRecord>) {
  if (record.preview.hasRender) {
    return {
      renderTarget: {
        contract: "preview.render",
        kind: "harness",
      } satisfies PreviewRenderTarget,
      selection: {
        contract: "preview.render",
        kind: "explicit",
      } satisfies PreviewSelection,
      trace: {
        contract: "preview.render" as const,
        importChain: [record.filePath],
        symbolChain: [`${record.filePath}#preview.render`],
      },
    };
  }

  const resolvedEntry = resolvePreviewEntryExport(record, recordsByPath);
  if (resolvedEntry) {
    return {
      renderTarget: {
        exportName: resolvedEntry.exportName,
        kind: "component",
        usesPreviewProps: record.preview.hasProps,
      } satisfies PreviewRenderTarget,
      selection: {
        contract: "preview.entry",
        kind: "explicit",
      } satisfies PreviewSelection,
      trace: {
        contract: "preview.entry" as const,
        importChain: resolvedEntry.trace.importChain,
        requestedSymbol: record.preview.entryLocalName,
        resolvedExportName: resolvedEntry.exportName,
        symbolChain: resolvedEntry.trace.symbolChain,
      },
    };
  }

  return undefined;
}

function isPreviewPackageInternalEntry(packageRoot: string, relativePath: string) {
  const previewPackageRoot = resolveRealFilePath(path.resolve(__dirname, "../../preview"));
  if (resolveRealFilePath(packageRoot) !== previewPackageRoot) {
    return false;
  }

  return PREVIEW_PACKAGE_ENTRY_EXCLUDES.some((prefix) => relativePath.startsWith(prefix));
}

function buildDescriptor(
  record: RawSourceModuleRecord,
  recordsByPath: Map<string, RawSourceModuleRecord>,
): {
  dependencyPaths: string[];
  descriptor: PreviewEntryDescriptor;
  discoveryDiagnostics: PreviewDiagnostic[];
  graphTrace: PreviewGraphTrace;
} {
  const explicitSelection = createExplicitSelection(record, recordsByPath);
  const candidateExportNames = getRenderableNamedExports(record, recordsByPath);
  const hasDefaultExport = hasRenderableDefaultExport(record, recordsByPath);
  const entryId = `${record.target.targetName}:${record.relativePath}`;
  const renderableCandidates = hasDefaultExport ? ["default", ...candidateExportNames] : [...candidateExportNames];
  const baseDiagnostics = [...collectTransitiveDiagnostics(entryId, record.filePath, recordsByPath).values()];

  let selection: PreviewSelection;
  let renderTarget: PreviewRenderTarget;
  let status: PreviewEntryStatus;
  let selectionTrace: PreviewGraphTrace["selection"];
  const entryDiagnostics = [...baseDiagnostics];

  if (explicitSelection) {
    selection = explicitSelection.selection;
    renderTarget = explicitSelection.renderTarget;
    selectionTrace = explicitSelection.trace;
    status = "ready";
  } else if (renderableCandidates.length > 1) {
    selection = {
      kind: "unresolved",
      reason: "ambiguous-exports",
    };
    renderTarget = {
      candidates: renderableCandidates,
      kind: "none",
      reason: "ambiguous-exports",
    };
    selectionTrace = {
      importChain: [record.filePath],
      symbolChain: [],
    };
    status = "ambiguous";
    entryDiagnostics.push(
      createEntryDiagnostic(
        "AMBIGUOUS_COMPONENT_EXPORTS",
        entryId,
        record.filePath,
        record.target.packageRoot,
        `Multiple component exports need explicit disambiguation: ${candidateExportNames.join(", ")}.`,
      ),
    );
  } else if (renderableCandidates.length === 1) {
    selection = {
      kind: "unresolved",
      reason: "missing-explicit-contract",
    };
    renderTarget = {
      candidates: renderableCandidates,
      kind: "none",
      reason: "missing-explicit-contract",
    };
    selectionTrace = {
      importChain: [record.filePath],
      requestedSymbol: record.preview.entryLocalName,
      symbolChain: [],
    };
    status = "needs_harness";
    entryDiagnostics.push(
      createEntryDiagnostic(
        "MISSING_EXPLICIT_PREVIEW_CONTRACT",
        entryId,
        record.filePath,
        record.target.packageRoot,
        `This file does not declare \`preview.entry\` or \`preview.render\`. ` +
          `Add an explicit preview contract to select ${renderableCandidates[0]}.`,
      ),
    );
  } else {
    selection = {
      kind: "unresolved",
      reason: "no-component-export",
    };
    renderTarget = {
      kind: "none",
      reason: candidateExportNames.length > 0 || hasDefaultExport ? "missing-explicit-contract" : "no-component-export",
    };
    selectionTrace = {
      importChain: [record.filePath],
      symbolChain: [],
    };
    status = "needs_harness";
    if (candidateExportNames.length === 0 && !hasDefaultExport) {
      entryDiagnostics.push(
        createEntryDiagnostic(
          "NO_COMPONENT_EXPORTS",
          entryId,
          record.filePath,
          record.target.packageRoot,
          "No exported component candidates were found for preview entry selection.",
        ),
      );
    }
  }

  if (record.preview.hasExport && !record.preview.hasRender && !createExplicitSelection(record, recordsByPath)) {
    entryDiagnostics.push(
      createEntryDiagnostic(
        "PREVIEW_RENDER_MISSING",
        entryId,
        record.filePath,
        record.target.packageRoot,
        "The file exports `preview`, but it does not define a usable `preview.entry` or callable `preview.render`.",
      ),
    );
  }

  const graphTrace = collectTransitiveGraphTrace(record.filePath, recordsByPath, selectionTrace);
  const dependencyPaths = collectTransitivePaths(record.filePath, recordsByPath).sort((left, right) =>
    left.localeCompare(right),
  );
  const diagnosticsSummary = createDiagnosticsSummary(entryDiagnostics);
  const title = record.preview.title?.trim() ? record.preview.title.trim() : humanizeTitle(record.relativePath);
  const descriptor: PreviewEntryDescriptor = {
    capabilities: createCapabilities(renderTarget),
    candidateExportNames,
    diagnosticsSummary,
    hasDefaultExport,
    hasPreviewExport: record.preview.hasExport,
    id: entryId,
    packageName: record.target.packageName,
    relativePath: record.relativePath,
    renderTarget,
    selection,
    sourceFilePath: record.filePath,
    status,
    statusDetails: createBaseStatusDetails(status, renderTarget),
    targetName: record.target.targetName,
    title,
  };

  return {
    dependencyPaths,
    descriptor,
    discoveryDiagnostics: entryDiagnostics.sort((left, right) => {
      if (left.relativeFile !== right.relativeFile) {
        return left.relativeFile.localeCompare(right.relativeFile);
      }

      return left.code.localeCompare(right.code);
    }),
    graphTrace,
  };
}

function createTargetContext(target: PreviewSourceTarget): TargetContext {
  const workspaceRoot = findWorkspaceRoot(target.packageRoot);
  return {
    packageName: target.packageName ?? target.name,
    packageRoot: resolveRealFilePath(target.packageRoot),
    sourceRoot: resolveRealFilePath(target.sourceRoot),
    targetName: target.name,
    workspaceRoot,
  };
}

function discoverTargetRecords(target: TargetContext, graphService: WorkspaceGraphService) {
  const recordsByPath = new Map<string, RawSourceModuleRecord>();
  const pending = [...graphService.listTargetSourceFiles(target)];

  while (pending.length > 0) {
    const nextFilePath = pending.pop();
    if (!nextFilePath || recordsByPath.has(nextFilePath)) {
      continue;
    }

    const record = parseModuleRecord(nextFilePath, target, graphService);
    recordsByPath.set(nextFilePath, record);

    for (const importPath of record.imports) {
      if (!recordsByPath.has(importPath)) {
        pending.push(importPath);
      }
    }
  }

  return recordsByPath;
}

export function discoverWorkspaceState(options: Pick<CreatePreviewEngineOptions, "projectName" | "targets">) {
  const targetContexts = options.targets.map(createTargetContext);
  const graphService = createWorkspaceGraphService({
    targets: targetContexts.map((target) => ({
      name: target.targetName,
      packageName: target.packageName,
      packageRoot: target.packageRoot,
      sourceRoot: target.sourceRoot,
    })),
    workspaceRoot: findWorkspaceRoot(targetContexts.map((target) => target.packageRoot)),
  });
  const entryStatesById = new Map<string, DiscoveredEntryState>();
  const entryDependencyPathsById = new Map<string, string[]>();
  const entries: PreviewEntryDescriptor[] = [];

  for (const target of targetContexts) {
    const recordsByPath = discoverTargetRecords(target, graphService);
    const entryRecords = [...recordsByPath.values()]
      .filter((record) => record.isTsx)
      .filter((record) => isFilePathUnderRoot(target.sourceRoot, record.filePath))
      .filter((record) => !isPreviewPackageInternalEntry(target.packageRoot, record.relativePath));

    for (const record of entryRecords) {
      const builtEntry = buildDescriptor(record, recordsByPath);
      entries.push(builtEntry.descriptor);
      entryStatesById.set(builtEntry.descriptor.id, {
        dependencyPaths: builtEntry.dependencyPaths,
        descriptor: builtEntry.descriptor,
        discoveryDiagnostics: builtEntry.discoveryDiagnostics,
        graphTrace: builtEntry.graphTrace,
        packageRoot: target.packageRoot,
        previewHasProps: record.preview.hasProps,
        target,
      });
      entryDependencyPathsById.set(builtEntry.descriptor.id, builtEntry.dependencyPaths);
    }
  }

  entries.sort((left, right) => {
    if (left.targetName !== right.targetName) {
      return left.targetName.localeCompare(right.targetName);
    }

    return left.relativePath.localeCompare(right.relativePath);
  });

  return {
    entryDependencyPathsById,
    entryStatesById,
    workspaceIndex: {
      entries,
      projectName: options.projectName,
      protocolVersion: PREVIEW_ENGINE_PROTOCOL_VERSION,
      targets: options.targets.map((target) => ({
        ...target,
        packageName: target.packageName ?? target.name,
      })),
    },
  } satisfies WorkspaceDiscoverySnapshot;
}
