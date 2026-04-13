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