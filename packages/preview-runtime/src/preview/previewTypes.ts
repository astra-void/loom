export type PreviewPropKind =
  | "array"
  | "bigint"
  | "boolean"
  | "function"
  | "literal"
  | "number"
  | "object"
  | "react-element"
  | "react-node"
  | "string"
  | "union"
  | "unknown";

export type PreviewPropMetadata = {
  kind: PreviewPropKind;
  type: string;
  required: boolean;
  elementType?: PreviewPropMetadata;
  literal?: boolean | number | string | null;
  properties?: Record<string, PreviewPropMetadata>;
  unionTypes?: PreviewPropMetadata[];
};

export type PreviewComponentPropsMetadata = {
  componentName: string;
  props: Record<string, PreviewPropMetadata>;
};
