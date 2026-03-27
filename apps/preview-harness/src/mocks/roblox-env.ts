import * as React from "react";
import {
	BillboardGui,
	CanvasGroup,
	Frame,
	ImageButton,
	ImageLabel,
	ScreenGui,
	ScrollingFrame,
	SurfaceGui,
	TextBox,
	TextButton,
	TextLabel,
	VideoFrame,
	ViewportFrame,
} from "../../../../packages/preview-runtime/src/hosts";
import { PreviewTargetShell } from "../../../../packages/preview-runtime/src/hosts/preview-targets/PreviewTargetShell";
import {
	installPreviewRuntimeGlobals,
	type PreviewRuntimeGlobalTarget,
} from "../../../../packages/preview-runtime/src/runtime/installPreviewRuntimeGlobals";

const PREVIEW_INTRINSIC_HOSTS_SYMBOL = Symbol.for(
	"loom-dev.preview-runtime.intrinsic-hosts",
);

const previewRuntimeIntrinsicHosts = {
	billboardgui: BillboardGui,
	canvasgroup: CanvasGroup,
	frame: Frame,
	imagebutton: ImageButton,
	imagelabel: ImageLabel,
	scrollingframe: ScrollingFrame,
	screengui: ScreenGui,
	surfacegui: SurfaceGui,
	textbox: TextBox,
	textbutton: TextButton,
	textlabel: TextLabel,
	videoframe: VideoFrame,
	viewportframe: ViewportFrame,
} as const;

export function setupRobloxEnvironment(
	target: PreviewRuntimeGlobalTarget = globalThis as PreviewRuntimeGlobalTarget,
) {
	const initializedTarget = installPreviewRuntimeGlobals(target);
	(
		initializedTarget as PreviewRuntimeGlobalTarget & {
			[PREVIEW_INTRINSIC_HOSTS_SYMBOL]?: typeof previewRuntimeIntrinsicHosts;
		}
	)[PREVIEW_INTRINSIC_HOSTS_SYMBOL] = previewRuntimeIntrinsicHosts;

	if (typeof window !== "undefined" && window !== target) {
		installPreviewRuntimeGlobals(window as Window & PreviewRuntimeGlobalTarget);
		(
			window as Window &
				PreviewRuntimeGlobalTarget & {
					[PREVIEW_INTRINSIC_HOSTS_SYMBOL]?: typeof previewRuntimeIntrinsicHosts;
				}
		)[PREVIEW_INTRINSIC_HOSTS_SYMBOL] = previewRuntimeIntrinsicHosts;
	}

	return initializedTarget;
}

export { React };
export * from "../../../../packages/preview-runtime/src/hosts/components";
export * from "../../../../packages/preview-runtime/src/hosts/domAdapter";
export * from "../../../../packages/preview-runtime/src/hosts/hostComponent";
export * from "../../../../packages/preview-runtime/src/hosts/hostOverrides";
export * from "../../../../packages/preview-runtime/src/hosts/modifiers";
export * from "../../../../packages/preview-runtime/src/hosts/resolveProps";
export * from "../../../../packages/preview-runtime/src/hosts/types";
export * from "../../../../packages/preview-runtime/src/hosts/useHostLayout";
export * from "../../../../packages/preview-runtime/src/layout";
export { loadPreviewLayoutEngineWasmBytes } from "../../../../packages/preview-runtime/src/layout/wasm";
export * from "../../../../packages/preview-runtime/src/preview";
export * from "../../../../packages/preview-runtime/src/react";
export * from "../../../../packages/preview-runtime/src/runtime/Enum";
export * from "../../../../packages/preview-runtime/src/runtime/frameScheduler";
export * from "../../../../packages/preview-runtime/src/runtime/helpers";
export * from "../../../../packages/preview-runtime/src/runtime/installPreviewRuntimeGlobals";
export * from "../../../../packages/preview-runtime/src/runtime/polyfills";
export * from "../../../../packages/preview-runtime/src/runtime/RunService";
export * from "../../../../packages/preview-runtime/src/runtime/robloxMock";
export * from "../../../../packages/preview-runtime/src/runtime/runtimeError";
export * from "../../../../packages/preview-runtime/src/runtime/services";
export * from "../../../../packages/preview-runtime/src/runtime/task";
export * from "../../../../packages/preview-runtime/src/style/index";
export { PreviewTargetShell };
