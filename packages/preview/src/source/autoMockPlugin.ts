import fs from "node:fs";
import path from "node:path";
import type { PreviewSourceTarget } from "@lattice-ui/preview-engine";
import type { PreviewComponentPropsMetadata, PreviewPropMetadata } from "@lattice-ui/preview-runtime";
import ts from "typescript";
import type { Plugin } from "vite";
import { isFilePathUnderRoot, resolveRealFilePath, stripFileIdDecorations } from "./pathUtils";

const SUPPORTED_COMPONENT_EXTENSIONS = new Set([".jsx", ".tsx"]);
const MAX_SERIALIZED_OBJECT_PROPERTIES = 16;
const SYNTHETIC_DEFAULT_EXPORT_NAME = "__previewDefaultExport";
const TYPE_FORMAT_FLAGS =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.InTypeAlias;

type ComponentDeclaration = ts.ClassDeclaration | ts.FunctionDeclaration | ts.VariableDeclaration;
type ProgramConfig = {
  fileNames: string[];
  options: ts.CompilerOptions;
};

export type CreateAutoMockPropsPluginOptions = {
  targets: PreviewSourceTarget[];
};

function normalizeFilePath(filePath: string) {
  const resolvedPath = resolveRealFilePath(filePath);
  return ts.sys.useCaseSensitiveFileNames ? resolvedPath : resolvedPath.toLowerCase();
}

function isSupportedComponentFile(filePath: string) {
  const normalizedPath = stripFileIdDecorations(filePath).toLowerCase();
  return SUPPORTED_COMPONENT_EXTENSIONS.has(path.extname(normalizedPath)) && !normalizedPath.endsWith(".d.tsx");
}

function isComponentName(name: string) {
  return /^[A-Z]/.test(name);
}

function hasExportModifier(node: ts.Node) {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function isDefaultExport(node: ts.Node) {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) !== 0;
}

function findNearestTsconfig(filePath: string) {
  return ts.findConfigFile(path.dirname(filePath), ts.sys.fileExists, "tsconfig.json");
}

function parseTsconfig(tsconfigPath: string) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    const message = ts.formatDiagnostic(configFile.error, {
      getCanonicalFileName: (value) => value,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });
    throw new Error(`Failed to read TypeScript config ${tsconfigPath}: ${message}`);
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    const message = ts.formatDiagnostics(parsed.errors, {
      getCanonicalFileName: (value) => value,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });
    throw new Error(`Failed to parse TypeScript config ${tsconfigPath}: ${message}`);
  }

  return parsed;
}

function createProgram(filePath: string, code: string, configCache: Map<string, ts.ParsedCommandLine>) {
  const tsconfigPath = findNearestTsconfig(filePath);
  const parsedConfig: ProgramConfig =
    tsconfigPath == null
      ? {
          options: {
            jsx: ts.JsxEmit.Preserve,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            target: ts.ScriptTarget.ESNext,
          },
          fileNames: [filePath],
        }
      : (() => {
          const parsed =
            configCache.get(tsconfigPath) ??
            (() => {
              const nextParsed = parseTsconfig(tsconfigPath);
              configCache.set(tsconfigPath, nextParsed);
              return nextParsed;
            })();

          return {
            fileNames: parsed.fileNames,
            options: parsed.options,
          };
        })();

  const compilerOptions: ts.CompilerOptions = {
    ...parsedConfig.options,
    jsx: parsedConfig.options.jsx ?? ts.JsxEmit.Preserve,
    noEmit: true,
  };
  const currentFilePath = normalizeFilePath(filePath);
  const rootNames = [...new Set([...parsedConfig.fileNames, filePath])];
  const host = ts.createCompilerHost(compilerOptions, true);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const defaultFileExists = host.fileExists.bind(host);

  host.fileExists = (candidate) => normalizeFilePath(candidate) === currentFilePath || defaultFileExists(candidate);
  host.readFile = (candidate) => (normalizeFilePath(candidate) === currentFilePath ? code : defaultReadFile(candidate));
  host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (normalizeFilePath(candidate) === currentFilePath) {
      return ts.createSourceFile(candidate, code, languageVersion, true, ts.ScriptKind.TSX);
    }

    return defaultGetSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile);
  };

  return ts.createProgram({
    options: compilerOptions,
    host,
    rootNames,
  });
}

function collectLocalComponentDeclarations(sourceFile: ts.SourceFile) {
  const declarations = new Map<string, ComponentDeclaration>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isComponentName(statement.name.text)) {
      declarations.set(statement.name.text, statement);
      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name && isComponentName(statement.name.text)) {
      declarations.set(statement.name.text, statement);
      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && isComponentName(declaration.name.text)) {
        declarations.set(declaration.name.text, declaration);
      }
    }
  }

  return declarations;
}

function collectExportedComponentNames(
  sourceFile: ts.SourceFile,
  localDeclarations: Map<string, ComponentDeclaration>,
) {
  const exportedNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name &&
      hasExportModifier(statement) &&
      localDeclarations.has(statement.name.text)
    ) {
      exportedNames.add(statement.name.text);
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && localDeclarations.has(declaration.name.text)) {
          exportedNames.add(declaration.name.text);
        }
      }
      continue;
    }

    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression) &&
      localDeclarations.has(statement.expression.text)
    ) {
      exportedNames.add(statement.expression.text);
      continue;
    }

    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause) {
      continue;
    }

    if (!ts.isNamedExports(statement.exportClause)) {
      continue;
    }

    for (const element of statement.exportClause.elements) {
      const localName = element.propertyName?.text ?? element.name.text;
      if (localDeclarations.has(localName)) {
        exportedNames.add(localName);
      }
    }
  }

  return [...exportedNames];
}

function getDeclarationSignature(declaration: ComponentDeclaration, checker: ts.TypeChecker): ts.Signature | undefined {
  if ((ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)) && declaration.name) {
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (symbol) {
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      const signature = checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0];
      if (signature) {
        return signature;
      }
    }

    if (ts.isFunctionDeclaration(declaration)) {
      return checker.getSignatureFromDeclaration(declaration);
    }

    return undefined;
  }

  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) {
    return undefined;
  }

  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol) {
    return undefined;
  }

  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const signature = checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0];
  if (signature) {
    return signature;
  }

  if (
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
  ) {
    return checker.getSignatureFromDeclaration(declaration.initializer);
  }

  return undefined;
}

function getExpressionSignature(expression: ts.Expression, checker: ts.TypeChecker): ts.Signature | undefined {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return checker.getSignatureFromDeclaration(expression);
  }

  const type = checker.getTypeAtLocation(expression);
  return checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0];
}

function isAnonymousDefaultExportExpression(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) {
    return isAnonymousDefaultExportExpression(expression.expression);
  }

  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) || ts.isClassExpression(expression);
}

function includesUndefined(type: ts.Type): boolean {
  if ((type.flags & ts.TypeFlags.Undefined) !== 0) {
    return true;
  }

  return type.isUnion() && type.types.some((member): boolean => includesUndefined(member));
}

function isReactNodeType(typeText: string) {
  return (
    typeText.includes("ReactNode") ||
    (typeText.includes("React.ReactElement") && typeText.includes("React.ReactPortal"))
  );
}

function isReactElementType(typeText: string) {
  return typeText.includes("JSX.Element") || typeText.includes("ReactElement");
}

function createLiteralMetadata(type: ts.Type, typeText: string): PreviewPropMetadata | undefined {
  if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
    return {
      kind: "literal",
      literal: (type as ts.StringLiteralType).value,
      required: true,
      type: typeText,
    };
  }

  if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
    return {
      kind: "literal",
      literal: (type as ts.NumberLiteralType).value,
      required: true,
      type: typeText,
    };
  }

  if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    return {
      kind: "literal",
      literal: typeText === "true",
      required: true,
      type: typeText,
    };
  }

  if ((type.flags & ts.TypeFlags.Null) !== 0) {
    return {
      kind: "literal",
      literal: null,
      required: true,
      type: typeText,
    };
  }

  return undefined;
}

function serializePropertySymbol(
  propertySymbol: ts.Symbol,
  checker: ts.TypeChecker,
  contextNode: ts.Node,
  seenTypes: Set<ts.Type>,
): PreviewPropMetadata {
  const declaration = propertySymbol.valueDeclaration ?? propertySymbol.declarations?.[0] ?? contextNode;
  const propertyType = checker.getTypeOfSymbolAtLocation(propertySymbol, declaration);
  const metadata = serializeType(propertyType, checker, declaration, seenTypes);
  metadata.required = (propertySymbol.flags & ts.SymbolFlags.Optional) === 0 && !includesUndefined(propertyType);
  return metadata;
}

function serializeType(
  type: ts.Type,
  checker: ts.TypeChecker,
  contextNode: ts.Node,
  seenTypes: Set<ts.Type>,
): PreviewPropMetadata {
  const typeText = checker.typeToString(type, contextNode, TYPE_FORMAT_FLAGS);
  if (isReactNodeType(typeText)) {
    return {
      kind: "react-node",
      required: true,
      type: typeText,
    };
  }

  if (isReactElementType(typeText)) {
    return {
      kind: "react-element",
      required: true,
      type: typeText,
    };
  }

  const literalMetadata = createLiteralMetadata(type, typeText);
  if (literalMetadata) {
    return literalMetadata;
  }

  if (type.isUnion()) {
    const filteredTypes = type.types.filter(
      (member) => (member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) === 0,
    );

    if (filteredTypes.length === 1) {
      return serializeType(filteredTypes[0]!, checker, contextNode, seenTypes);
    }

    return {
      kind: "union",
      required: true,
      type: typeText,
      unionTypes: filteredTypes.map((member) => serializeType(member, checker, contextNode, seenTypes)),
    };
  }

  if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) {
    return {
      kind: "boolean",
      required: true,
      type: typeText,
    };
  }

  if ((type.flags & ts.TypeFlags.StringLike) !== 0) {
    return {
      kind: "string",
      required: true,
      type: typeText,
    };
  }

  if ((type.flags & ts.TypeFlags.NumberLike) !== 0) {
    return {
      kind: "number",
      required: true,
      type: typeText,
    };
  }

  if ((type.flags & ts.TypeFlags.BigIntLike) !== 0) {
    return {
      kind: "bigint",
      required: true,
      type: typeText,
    };
  }

  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
    return {
      kind: "function",
      required: true,
      type: typeText,
    };
  }

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [elementType] = checker.getTypeArguments(type as ts.TypeReference);
    return {
      kind: "array",
      elementType: elementType ? serializeType(elementType, checker, contextNode, seenTypes) : undefined,
      required: true,
      type: typeText,
    };
  }

  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0) {
    return {
      kind: "unknown",
      required: true,
      type: typeText,
    };
  }

  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    if (seenTypes.has(type)) {
      return {
        kind: "object",
        required: true,
        type: typeText,
      };
    }

    const propertySymbols = checker.getPropertiesOfType(type);
    if (propertySymbols.length === 0 || propertySymbols.length > MAX_SERIALIZED_OBJECT_PROPERTIES) {
      return {
        kind: "object",
        required: true,
        type: typeText,
      };
    }

    seenTypes.add(type);
    const properties: Record<string, PreviewPropMetadata> = {};

    for (const propertySymbol of propertySymbols) {
      if (propertySymbol.getName() === "__proto__") {
        continue;
      }

      properties[propertySymbol.getName()] = serializePropertySymbol(propertySymbol, checker, contextNode, seenTypes);
    }

    seenTypes.delete(type);
    return Object.keys(properties).length > 0
      ? {
          kind: "object",
          properties,
          required: true,
          type: typeText,
        }
      : {
          kind: "object",
          required: true,
          type: typeText,
        };
  }

  return {
    kind: "unknown",
    required: true,
    type: typeText,
  };
}

function createComponentMetadata(
  componentName: string,
  declaration: ComponentDeclaration,
  checker: ts.TypeChecker,
): PreviewComponentPropsMetadata | undefined {
  const signature = getDeclarationSignature(declaration, checker);
  return createMetadataFromSignature(componentName, signature, declaration, checker);
}

function createMetadataFromSignature(
  componentName: string,
  signature: ts.Signature | undefined,
  declarationNode: ts.Node,
  checker: ts.TypeChecker,
): PreviewComponentPropsMetadata | undefined {
  if (!signature) {
    return undefined;
  }

  const [propsParameter] = signature.getParameters();
  if (!propsParameter) {
    return {
      componentName,
      props: {},
    };
  }

  const propsDeclarationNode = propsParameter.valueDeclaration ?? declarationNode;
  const propsType = checker.getTypeOfSymbolAtLocation(propsParameter, propsDeclarationNode);
  const props: Record<string, PreviewPropMetadata> = {};

  for (const propertySymbol of checker.getPropertiesOfType(propsType)) {
    props[propertySymbol.getName()] = serializePropertySymbol(propertySymbol, checker, propsDeclarationNode, new Set());
  }

  return {
    componentName,
    props,
  };
}

function createAnonymousDefaultExportMetadata(sourceFile: ts.SourceFile, checker: ts.TypeChecker) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      isAnonymousDefaultExportExpression(statement.expression)
    ) {
      const targetExpression = ts.isParenthesizedExpression(statement.expression)
        ? statement.expression.expression
        : statement.expression;
      const signature = getExpressionSignature(targetExpression, checker);
      const metadata = createMetadataFromSignature(SYNTHETIC_DEFAULT_EXPORT_NAME, signature, targetExpression, checker);

      if (metadata) {
        return {
          metadata,
          name: SYNTHETIC_DEFAULT_EXPORT_NAME,
        };
      }
    }

    if (
      ts.isFunctionDeclaration(statement) &&
      hasExportModifier(statement) &&
      isDefaultExport(statement) &&
      !statement.name
    ) {
      const metadata = createMetadataFromSignature(
        SYNTHETIC_DEFAULT_EXPORT_NAME,
        checker.getSignatureFromDeclaration(statement),
        statement,
        checker,
      );

      if (metadata) {
        return {
          metadata,
          name: SYNTHETIC_DEFAULT_EXPORT_NAME,
        };
      }
    }
  }

  return undefined;
}

function replaceSourceRange(sourceText: string, start: number, end: number, replacement: string) {
  return `${sourceText.slice(0, start)}${replacement}${sourceText.slice(end)}`;
}

function normalizeAnonymousDefaultExport(sourceFile: ts.SourceFile, code: string) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      isAnonymousDefaultExportExpression(statement.expression)
    ) {
      const expressionText = code.slice(statement.expression.getStart(sourceFile), statement.expression.end);
      return replaceSourceRange(
        code,
        statement.getStart(sourceFile),
        statement.end,
        `const ${SYNTHETIC_DEFAULT_EXPORT_NAME} = ${expressionText};\nexport default ${SYNTHETIC_DEFAULT_EXPORT_NAME};`,
      );
    }

    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      hasExportModifier(statement) &&
      isDefaultExport(statement) &&
      !statement.name
    ) {
      const statementText = code.slice(statement.getStart(sourceFile), statement.end);
      const declarationText = statementText.replace(/^export\s+default\s+/, "");
      return replaceSourceRange(
        code,
        statement.getStart(sourceFile),
        statement.end,
        `const ${SYNTHETIC_DEFAULT_EXPORT_NAME} = ${declarationText};\nexport default ${SYNTHETIC_DEFAULT_EXPORT_NAME};`,
      );
    }
  }

  return code;
}

function injectComponentMetadata(
  code: string,
  componentMetadata: Array<{ metadata: PreviewComponentPropsMetadata; name: string }>,
) {
  if (componentMetadata.length === 0) {
    return undefined;
  }

  const injectedStatements = componentMetadata
    .map(({ metadata, name }) => `if (${name}) {\n  ${name}.__previewProps = ${JSON.stringify(metadata)};\n}`)
    .join("\n\n");

  return `${code}\n\n${injectedStatements}\n`;
}

export function createAutoMockPropsPlugin(options: CreateAutoMockPropsPluginOptions): Plugin {
  const configCache = new Map<string, ts.ParsedCommandLine>();

  return {
    name: "lattice-preview-auto-mock-props",
    enforce: "pre",
    transform(code, id) {
      const filePath = stripFileIdDecorations(id);
      if (
        !isSupportedComponentFile(filePath) ||
        !options.targets.some((target) => isFilePathUnderRoot(target.sourceRoot, filePath))
      ) {
        return undefined;
      }

      if (!fs.existsSync(filePath)) {
        return undefined;
      }

      const program = createProgram(filePath, code, configCache);
      const sourceFile = program.getSourceFile(filePath);
      if (!sourceFile) {
        return undefined;
      }

      const checker = program.getTypeChecker();
      const localDeclarations = collectLocalComponentDeclarations(sourceFile);
      const defaultExportMetadata = createAnonymousDefaultExportMetadata(sourceFile, checker);

      if (localDeclarations.size === 0 && !defaultExportMetadata) {
        return undefined;
      }

      const injectedMetadata = collectExportedComponentNames(sourceFile, localDeclarations)
        .map((name) => {
          const declaration = localDeclarations.get(name);
          if (!declaration) {
            return undefined;
          }

          const metadata = createComponentMetadata(name, declaration, checker);
          return metadata ? { metadata, name } : undefined;
        })
        .filter((value): value is { metadata: PreviewComponentPropsMetadata; name: string } => value !== undefined);

      if (defaultExportMetadata) {
        injectedMetadata.push(defaultExportMetadata);
      }

      const normalizedCode = defaultExportMetadata ? normalizeAnonymousDefaultExport(sourceFile, code) : code;
      const transformedCode = injectComponentMetadata(normalizedCode, injectedMetadata);
      if (!transformedCode) {
        return undefined;
      }

      return {
        code: transformedCode,
        map: null,
      };
    },
  };
}
