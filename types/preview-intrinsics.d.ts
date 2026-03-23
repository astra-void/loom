export interface PreviewTargetIntrinsicElements {
	frame: Record<string, unknown>;
	textlabel: Record<string, unknown>;
}

export interface PreviewFixtureIntrinsicElements
	extends PreviewTargetIntrinsicElements {
	imagelabel: Record<string, unknown>;
	scrollingframe: Record<string, unknown>;
	textbutton: Record<string, unknown>;
	uicorner: Record<string, unknown>;
	uilistlayout: Record<string, unknown>;
	uipadding: Record<string, unknown>;
	uistroke: Record<string, unknown>;
}
