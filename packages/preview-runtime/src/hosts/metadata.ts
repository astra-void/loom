import rawPreviewHostMetadata from "./metadata.json";

export type PreviewHostMetadataRecord = {
  abstractAncestors: string[];
  degraded: boolean;
  domTag: string;
  fullSizeDefault: boolean;
  jsxName: string;
  participatesInLayout: boolean;
  runtimeName: string;
  supportsIsa: boolean;
  supportsTypeRewrite: boolean;
};

type PreviewHostMetadataDocument = {
  hosts: PreviewHostMetadataRecord[];
};

const previewHostMetadataDocument = rawPreviewHostMetadata as PreviewHostMetadataDocument;

function dedupeAndSort(values: Iterable<string>) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function createHostNodeTypeMap(records: PreviewHostMetadataRecord[]) {
  return Object.freeze(
    Object.fromEntries(records.map((record) => [record.jsxName, record.runtimeName])) as Record<string, string>,
  );
}

function validatePreviewHostMetadata(records: PreviewHostMetadataRecord[]) {
  const jsxNames = new Set<string>();
  const runtimeNames = new Set<string>();

  for (const record of records) {
    if (jsxNames.has(record.jsxName)) {
      throw new Error(`Duplicate preview host metadata jsxName: ${record.jsxName}`);
    }

    if (runtimeNames.has(record.runtimeName)) {
      throw new Error(`Duplicate preview host metadata runtimeName: ${record.runtimeName}`);
    }

    jsxNames.add(record.jsxName);
    runtimeNames.add(record.runtimeName);
  }
}

export const previewHostMetadataRecords = Object.freeze(
  previewHostMetadataDocument.hosts.map((record) => ({
    ...record,
    abstractAncestors: [...record.abstractAncestors],
  })),
);

validatePreviewHostMetadata([...previewHostMetadataRecords]);

export const previewHostMetadataByJsxName = new Map(
  previewHostMetadataRecords.map((record) => [record.jsxName, record] as const),
);
export const previewHostMetadataByRuntimeName = new Map(
  previewHostMetadataRecords.map((record) => [record.runtimeName, record] as const),
);

export const layoutHostMetadataRecords = Object.freeze(
  previewHostMetadataRecords.filter((record) => record.participatesInLayout),
);
export const layoutHostNodeType = createHostNodeTypeMap([...layoutHostMetadataRecords]);
export const fullSizeLayoutHostNames = Object.freeze(
  layoutHostMetadataRecords.filter((record) => record.fullSizeDefault).map((record) => record.jsxName),
);
export const degradedPreviewHostNames = Object.freeze(
  previewHostMetadataRecords.filter((record) => record.degraded).map((record) => record.jsxName),
);
export const previewHostDomTags = Object.freeze(
  Object.fromEntries(previewHostMetadataRecords.map((record) => [record.jsxName, record.domTag])) as Record<string, string>,
);
export const supportedHostJsxNames = Object.freeze(previewHostMetadataRecords.map((record) => record.jsxName));
export const supportedHostRuntimeNames = Object.freeze(previewHostMetadataRecords.map((record) => record.runtimeName));
export const supportedTypeRewriteNames = Object.freeze(
  dedupeAndSort(
    previewHostMetadataRecords.flatMap((record) =>
      record.supportsTypeRewrite ? [record.runtimeName, ...record.abstractAncestors] : [],
    ),
  ),
);
export const supportedIsaNames = Object.freeze(
  dedupeAndSort(
    previewHostMetadataRecords.flatMap((record) => (record.supportsIsa ? [record.runtimeName, ...record.abstractAncestors] : [])),
  ),
);

export function getPreviewHostMetadataByJsxName(jsxName: string) {
  return previewHostMetadataByJsxName.get(jsxName);
}

export function getPreviewHostMetadataByRuntimeName(runtimeName: string) {
  return previewHostMetadataByRuntimeName.get(runtimeName);
}

export function isPreviewHostTypeSupported(typeName: string, kind: "isa" | "typeRewrite") {
  const record = getPreviewHostMetadataByRuntimeName(typeName);
  if (record) {
    return kind === "isa" ? record.supportsIsa : record.supportsTypeRewrite;
  }

  const supportedSet = kind === "isa" ? supportedIsaNames : supportedTypeRewriteNames;
  return supportedSet.includes(typeName);
}

export function previewHostMatchesType(jsxName: string, typeName: string, kind: "isa" | "typeRewrite" = "isa") {
  const record = getPreviewHostMetadataByJsxName(jsxName);
  if (!record) {
    return false;
  }

  if ((kind === "isa" && !record.supportsIsa) || (kind === "typeRewrite" && !record.supportsTypeRewrite)) {
    return false;
  }

  return record.runtimeName === typeName || record.abstractAncestors.includes(typeName);
}

export function isDegradedPreviewHost(jsxName: string) {
  return degradedPreviewHostNames.includes(jsxName);
}
