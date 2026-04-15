import { expect, test } from "vitest";

import { resolvePreviewDomProps } from "../../packages/preview-runtime/src/hosts/resolveProps";
import type { PreviewDomProps } from "../../packages/preview-runtime/src/hosts/types";

function resolveTextHostStyle(
	host: "textbutton" | "textlabel",
	props: PreviewDomProps,
) {
	const resolved = resolvePreviewDomProps(props, {
		applyComputedLayout: false,
		computed: null,
		host,
		nodeId: `${host}:preview-node`,
	});

	return resolved.domProps.style as {
		justifyContent?: string;
		textAlign?: string;
	};
}

function resolveFrameHostStyle(props: PreviewDomProps) {
	const resolved = resolvePreviewDomProps(props, {
		computed: {
			height: 200,
			width: 100,
			x: 10,
			y: 20,
		},
		host: "frame",
		nodeId: "frame:preview-node",
	});

	return resolved.domProps.style as {
		display?: string;
		height?: string;
		left?: string;
		pointerEvents?: string;
		top?: string;
		width?: string;
	};
}

test("textlabel defaults alignment to center when no alignment props are provided", () => {
	const style = resolveTextHostStyle("textlabel", {
		Text: "Preview label",
	});

	expect(style.textAlign).toBe("center");
	expect(style.justifyContent).toBe("center");
});

test("textlabel keeps explicit alignment mappings", () => {
	const style = resolveTextHostStyle("textlabel", {
		Text: "Preview label",
		TextXAlignment: "right",
		TextYAlignment: "bottom",
	});

	expect(style.textAlign).toBe("right");
	expect(style.justifyContent).toBe("flex-end");
});

test("textbutton defaults alignment to center when no alignment props are provided", () => {
	const style = resolveTextHostStyle("textbutton", {
		Text: "Preview button",
	});

	expect(style.textAlign).toBe("center");
	expect(style.justifyContent).toBe("center");
});

test("textbutton keeps explicit alignment mappings", () => {
	const style = resolveTextHostStyle("textbutton", {
		Text: "Preview button",
		TextXAlignment: "right",
		TextYAlignment: "bottom",
	});

	expect(style.textAlign).toBe("right");
	expect(style.justifyContent).toBe("flex-end");
});

test("frame applies position and size offsets on computed layout", () => {
	const style = resolveFrameHostStyle({
		Position: {
			X: { Offset: 5, Scale: 0 },
			Y: { Offset: 7, Scale: 0 },
		},
		Size: {
			X: { Offset: 150, Scale: 0 },
			Y: { Offset: 250, Scale: 0 },
		},
	});

	expect(style.left).toBe("15px");
	expect(style.top).toBe("27px");
	expect(style.width).toBe("150px");
	expect(style.height).toBe("250px");
});

test("frame becomes non-interactive when Active is false", () => {
	const style = resolveFrameHostStyle({
		Active: false,
	});

	expect(style.pointerEvents).toBe("none");
});

test("frame hides and disables input when Visible is false and Active is false", () => {
	const style = resolveFrameHostStyle({
		Active: false,
		Visible: false,
	});

	expect(style.display).toBe("none");
	expect(style.pointerEvents).toBe("none");
});
