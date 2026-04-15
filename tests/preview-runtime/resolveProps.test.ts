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
		pointerEvents?: string;
		textAlign?: string;
		zIndex?: number | string;
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
		zIndex?: number | string;
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

test("frame defaults to non-interactive unless Active is true", () => {
	const inactiveStyle = resolveFrameHostStyle({});
	const activeStyle = resolveFrameHostStyle({
		Active: true,
	});

	expect(inactiveStyle.pointerEvents).toBe("none");
	expect(activeStyle.pointerEvents).toBe("auto");
});

test("button-like hosts are pointer-interactive by default but respect Active false", () => {
	const activeStyle = resolveTextHostStyle("textbutton", {
		Text: "Preview button",
	});
	const disabledStyle = resolveTextHostStyle("textbutton", {
		Active: false,
		Text: "Preview button",
	});

	expect(activeStyle.pointerEvents).toBe("auto");
	expect(disabledStyle.pointerEvents).toBe("none");
});

test("gui object hosts receive a Roblox-like default z-index", () => {
	const frameStyle = resolveFrameHostStyle({});
	const textButtonStyle = resolveTextHostStyle("textbutton", {
		Text: "Preview button",
	});

	expect(frameStyle.zIndex).toBe(1);
	expect(textButtonStyle.zIndex).toBe(1);
});

test("frame hides and disables input when Visible is false and Active is false", () => {
	const style = resolveFrameHostStyle({
		Active: false,
		Visible: false,
	});

	expect(style.display).toBe("none");
	expect(style.pointerEvents).toBe("none");
});
