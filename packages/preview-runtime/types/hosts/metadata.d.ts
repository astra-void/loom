export type PreviewPlaceholderBehavior = "none" | "container" | "opaque";
export type PreviewHostMetadataRecord = {
	abstractAncestors: string[];
	degraded: boolean;
	domTag: string;
	fullSizeDefault: boolean;
	jsxName: string;
	placeholderBehavior: PreviewPlaceholderBehavior;
	participatesInLayout: boolean;
	runtimeName: string;
	supportsIsa: boolean;
	supportsTypeRewrite: boolean;
};
export declare const previewHostMetadataRecords: readonly {
	abstractAncestors: string[];
	degraded: boolean;
	domTag: string;
	fullSizeDefault: boolean;
	jsxName: string;
	placeholderBehavior: PreviewPlaceholderBehavior;
	participatesInLayout: boolean;
	runtimeName: string;
	supportsIsa: boolean;
	supportsTypeRewrite: boolean;
}[];
export declare const previewHostMetadataByJsxName: Map<
	string,
	{
		abstractAncestors: string[];
		degraded: boolean;
		domTag: string;
		fullSizeDefault: boolean;
		jsxName: string;
		placeholderBehavior: PreviewPlaceholderBehavior;
		participatesInLayout: boolean;
		runtimeName: string;
		supportsIsa: boolean;
		supportsTypeRewrite: boolean;
	}
>;
export declare const previewHostMetadataByRuntimeName: Map<
	string,
	{
		abstractAncestors: string[];
		degraded: boolean;
		domTag: string;
		fullSizeDefault: boolean;
		jsxName: string;
		placeholderBehavior: PreviewPlaceholderBehavior;
		participatesInLayout: boolean;
		runtimeName: string;
		supportsIsa: boolean;
		supportsTypeRewrite: boolean;
	}
>;
export declare const runtimeOnlyTypeNames: readonly string[];
export declare const layoutHostMetadataRecords: readonly {
	abstractAncestors: string[];
	degraded: boolean;
	domTag: string;
	fullSizeDefault: boolean;
	jsxName: string;
	placeholderBehavior: PreviewPlaceholderBehavior;
	participatesInLayout: boolean;
	runtimeName: string;
	supportsIsa: boolean;
	supportsTypeRewrite: boolean;
}[];
export declare const layoutHostNodeType: Readonly<Record<string, string>>;
export declare const fullSizeLayoutHostNames: readonly string[];
export declare const degradedPreviewHostNames: readonly string[];
export declare const degradedContainerPreviewHostNames: readonly string[];
export declare const degradedOpaquePreviewHostNames: readonly string[];
export declare const previewHostDomTags: Readonly<Record<string, string>>;
export declare const supportedHostJsxNames: readonly string[];
export declare const supportedHostRuntimeNames: readonly string[];
export declare const supportedTypeRewriteNames: readonly string[];
export declare const supportedIsaNames: readonly string[];
export declare function getPreviewHostMetadataByJsxName(jsxName: string):
	| {
			abstractAncestors: string[];
			degraded: boolean;
			domTag: string;
			fullSizeDefault: boolean;
			jsxName: string;
			placeholderBehavior: PreviewPlaceholderBehavior;
			participatesInLayout: boolean;
			runtimeName: string;
			supportsIsa: boolean;
			supportsTypeRewrite: boolean;
	  }
	| undefined;
export declare function getPreviewHostMetadataByRuntimeName(
	runtimeName: string,
):
	| {
			abstractAncestors: string[];
			degraded: boolean;
			domTag: string;
			fullSizeDefault: boolean;
			jsxName: string;
			placeholderBehavior: PreviewPlaceholderBehavior;
			participatesInLayout: boolean;
			runtimeName: string;
			supportsIsa: boolean;
			supportsTypeRewrite: boolean;
	  }
	| undefined;
export declare function getPreviewPlaceholderBehaviorByJsxName(
	jsxName: string,
): PreviewPlaceholderBehavior;
export declare function getPreviewPlaceholderBehaviorByRuntimeName(
	runtimeName: string,
): PreviewPlaceholderBehavior;
export declare function isPreviewHostTypeSupported(
	typeName: string,
	kind: "isa" | "typeRewrite",
): boolean;
export declare function previewHostMatchesType(
	jsxName: string,
	typeName: string,
	kind?: "isa" | "typeRewrite",
): boolean;
export declare function isDegradedPreviewHost(jsxName: string): boolean;
export declare function isContainerDegradedPreviewHost(
	jsxName: string,
): boolean;
export declare function isOpaqueDegradedPreviewHost(jsxName: string): boolean;
