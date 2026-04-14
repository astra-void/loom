import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewHeadlessSession } from "../../packages/preview/src/headless";
import {
	suppressExpectedConsoleMessages,
	suppressExpectedStderrMessages,
} from "../testLogUtils";

const temporaryRoots: string[] = [];
let restoreExpectedLogs: (() => void) | undefined;

vi.setConfig({ testTimeout: 20000 });

beforeEach(() => {
	const restoreConsole = suppressExpectedConsoleMessages({
		error: [
			"[vite] (ssr) Error when evaluating SSR module",
			"load failed",
			"render failed",
			"HeadlessRenderBoundary",
			"Maximum update depth exceeded",
		],
		warn: ["DEGRADED_HOST_RENDER"],
	});
	const restoreStderr = suppressExpectedStderrMessages([
		/\[vite\] \(ssr\) Error when evaluating SSR module/,
		/load failed/,
		/The build was canceled/,
	]);

	restoreExpectedLogs = () => {
		restoreConsole();
		restoreStderr();
	};
});

afterEach(() => {
	restoreExpectedLogs?.();
	restoreExpectedLogs = undefined;
	vi.restoreAllMocks();
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
	delete (globalThis as typeof globalThis & { __loomComboboxTrace?: string[] })
		.__loomComboboxTrace;
	delete (
		globalThis as typeof globalThis & { __loomComboboxRefCycles?: number }
	).__loomComboboxRefCycles;
});

function createTempPreviewPackage(files: Record<string, string>) {
	const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-headless-"));
	temporaryRoots.push(packageRoot);

	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(packageRoot, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf8");
	}

	if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "@fixtures/headless-preview" }, null, 2),
			"utf8",
		);
	}

	return packageRoot;
}

function _createWorkspaceTempPreviewPackage(files: Record<string, string>) {
	const packageRoot = fs.mkdtempSync(
		path.join(process.cwd(), ".loom-headless-"),
	);
	temporaryRoots.push(packageRoot);

	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(packageRoot, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf8");
	}

	if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ name: "playground" }, null, 2),
			"utf8",
		);
	}

	return packageRoot;
}

function createFixtureTempPreviewPackage(fixtureName: string) {
	const packageRoot = fs.mkdtempSync(
		path.join(process.cwd(), ".loom-headless-"),
	);
	temporaryRoots.push(packageRoot);

	const fixtureRoot = path.join(__dirname, "fixtures", fixtureName);
	for (const entry of fs.readdirSync(fixtureRoot, { withFileTypes: true })) {
		const sourcePath = path.join(fixtureRoot, entry.name);
		const targetPath = path.join(packageRoot, entry.name);
		if (entry.isDirectory()) {
			fs.cpSync(sourcePath, targetPath, { recursive: true });
			continue;
		}

		fs.copyFileSync(sourcePath, targetPath);
	}

	return packageRoot;
}

function _copyPreviewRuntimeSourceTree(packageRoot: string) {
	const sourceRoot = path.resolve(
		process.cwd(),
		"packages/preview-runtime/src",
	);
	const distRoot = path.resolve(process.cwd(), "packages/preview-runtime/dist");
	const targetRoot = path.join(packageRoot, "vendor/preview-runtime/src");
	const targetDistRoot = path.join(packageRoot, "vendor/preview-runtime/dist");
	const targetReactRoot = path.join(targetRoot, "react");
	const targetHostsRoot = path.join(targetRoot, "hosts");
	fs.mkdirSync(targetReactRoot, { recursive: true });
	fs.mkdirSync(targetHostsRoot, { recursive: true });
	fs.writeFileSync(
		path.join(packageRoot, "vendor/preview-runtime/package.json"),
		JSON.stringify({ type: "commonjs" }, null, 2),
		"utf8",
	);
	fs.cpSync(distRoot, targetDistRoot, { recursive: true });
	const rewriteCommonJsBundle = (directory: string) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				rewriteCommonJsBundle(entryPath);
				continue;
			}

			if (!entry.name.endsWith(".js")) {
				continue;
			}

			const cjsPath = entryPath.replace(/\.js$/, ".cjs");
			const rewritten = fs
				.readFileSync(entryPath, "utf8")
				.replace(/(\.js)(?=['"])/g, ".cjs");
			fs.writeFileSync(cjsPath, rewritten, "utf8");
		}
	};
	rewriteCommonJsBundle(targetDistRoot);
	fs.writeFileSync(
		path.join(packageRoot, "vendor/preview-runtime/bridge.ts"),
		`
			import { createRequire } from "node:module";

			const require = createRequire(import.meta.url);
			const portalRuntime = require("./dist/react/portal.cjs") as typeof import("./dist/react/portal.d.ts");
			const presenceRuntime = require("./dist/react/presence.cjs") as typeof import("./dist/react/presence.d.ts");
			const slotRuntime = require("./dist/react/slot.cjs") as typeof import("./dist/react/slot.d.ts");
			const controllableStateRuntime = require("./dist/react/useControllableState.cjs") as typeof import("./dist/react/useControllableState.d.ts");
			const shellRuntime = require("./dist/hosts/preview-targets/PreviewTargetShell.cjs") as typeof import("./dist/hosts/preview-targets/PreviewTargetShell.d.ts");

			export const Portal = portalRuntime.Portal;
			export const PortalProvider = portalRuntime.PortalProvider;
			export const Presence = presenceRuntime.Presence;
			export const Slot = slotRuntime.Slot;
			export const useControllableState = controllableStateRuntime.useControllableState;
			export const PreviewTargetShell = shellRuntime.PreviewTargetShell;
		`,
		"utf8",
	);

	for (const fileName of [
		"portal.tsx",
		"presence.tsx",
		"useControllableState.ts",
	]) {
		fs.copyFileSync(
			path.join(sourceRoot, "react", fileName),
			path.join(targetReactRoot, fileName),
		);
	}

	const slotSource = fs
		.readFileSync(path.join(sourceRoot, "react", "slot.tsx"), "utf8")
		.replace(
			/normalized\.text \? \(\s*<span key="preview-slot-text" className="preview-host-text">\s*\{\s*normalized\.text\s*\}\s*<\/span>\s*\) : null,/s,
			"normalized.text ?? null,",
		);
	fs.writeFileSync(path.join(targetReactRoot, "slot.tsx"), slotSource, "utf8");

	fs.writeFileSync(
		path.join(targetHostsRoot, "types.ts"),
		`
			import type * as React from "react";

			export type PreviewEventTable = {
				Activated?: (...args: unknown[]) => void;
				FocusLost?: (...args: unknown[]) => void;
				InputBegan?: (...args: unknown[]) => void;
			};

			export type ForwardedDomProps = Record<string, unknown>;

			export type HostName = string;

			export type PreviewDomProps = {
				Change?: {
					Text?: (element: HTMLInputElement) => void;
				};
				Event?: PreviewEventTable;
				Text?: unknown;
				children?: React.ReactNode;
				className?: string;
				style?: React.CSSProperties;
				[key: string]: unknown;
			} & ForwardedDomProps;
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetHostsRoot, "resolveProps.ts"),
		`
			import type * as React from "react";
			import type { HostName, PreviewDomProps, PreviewEventTable } from "./types";

			export type ResolvedPreviewDomProps = {
				children: React.ReactNode;
				disabled: boolean;
				domProps: Record<string, unknown>;
				image: unknown;
				text: string | undefined;
			};

			export function resolvePreviewDomProps(
				props: PreviewDomProps,
				_options: { applyComputedLayout?: boolean; computed: null; host: HostName; nodeId: string },
			): ResolvedPreviewDomProps {
				const textValue =
					typeof props.Text === "string"
						? props.Text
						: props.Text === undefined || props.Text === null
							? undefined
							: String(props.Text);

				return {
					children: props.children ?? null,
					disabled: false,
					domProps: { ...props },
					image: undefined,
					text: textValue,
				};
			}
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetHostsRoot, "components.tsx"),
		`
			import * as React from "react";
			import type { PreviewDomProps } from "./types";

			type HostProps = PreviewDomProps & { children?: React.ReactNode };

			function createHost(displayName: string) {
				const Component = React.forwardRef<HTMLElement, HostProps>((props, forwardedRef) => {
					const instanceRef = React.useRef<
						(Partial<GuiObject> & {
							IsA(name: string): boolean;
							Text?: string;
						}) | null
					>(null);

					if (!instanceRef.current) {
						instanceRef.current = {
							IsA(name: string) {
								return name === "Instance" || name === "GuiObject";
							},
							Text: typeof props.Text === "string" ? props.Text : undefined,
						};
					}

					React.useLayoutEffect(() => {
						const instance = instanceRef.current;
						if (!instance) {
							return;
						}

						if (typeof forwardedRef === "function") {
							forwardedRef(instance as unknown as HTMLElement);
						} else if (forwardedRef) {
							(forwardedRef as React.MutableRefObject<HTMLElement | null>).current =
								instance as unknown as HTMLElement;
						}

						return () => {
							if (typeof forwardedRef === "function") {
								forwardedRef(null);
							} else if (forwardedRef) {
								(forwardedRef as React.MutableRefObject<HTMLElement | null>).current =
									null;
							}
						};
					}, [forwardedRef]);

					React.useEffect(() => {
						if (displayName !== "TextBox") {
							return;
						}

						const instance = instanceRef.current;
						if (!instance) {
							return;
						}

						const nextText = typeof props.Text === "string" ? props.Text : "";
						const previousText = instance.Text ?? "";
						instance.Text = nextText;

						if (nextText !== previousText) {
							const handler = props.Change?.Text;
							if (typeof handler === "function") {
								handler(instance as unknown as HTMLInputElement);
							}
						}
					}, [displayName, props.Change, props.Text]);

					return <>{props.children}</>;
				});

				Component.displayName = displayName;
				return Component;
			}

			export const BillboardGui = createHost("BillboardGui");
			export const CanvasGroup = createHost("CanvasGroup");
			export const Frame = createHost("Frame");
			export const ImageButton = createHost("ImageButton");
			export const ImageLabel = createHost("ImageLabel");
			export const ScreenGui = createHost("ScreenGui");
			export const ScrollingFrame = createHost("ScrollingFrame");
			export const SurfaceGui = createHost("SurfaceGui");
			export const TextBox = createHost("TextBox");
			export const TextButton = createHost("TextButton");
			export const TextLabel = createHost("TextLabel");
			export const VideoFrame = createHost("VideoFrame");
			export const ViewportFrame = createHost("ViewportFrame");
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetRoot, "react", "slotHost.ts"),
		`
			import type { HostName } from "../hosts/types";

			export function resolvePreviewSlotHost(childType: unknown): HostName {
				if (typeof childType === "string") {
					return childType === "button" ? "textbutton" : childType;
				}

				return "frame";
			}
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetHostsRoot, "resolveProps.ts"),
		`
			import type * as React from "react";
			import { PREVIEW_HOST_DATA_ATTRIBUTE } from "../internal/previewAttributes";
			import type { ComputedRect } from "../layout/model";
			import { toCssColor } from "../runtime/helpers";
			import { mapRobloxFont } from "../style/textStyles";
			import type {
				ForwardedDomProps,
				HostName,
				PreviewDomProps,
				PreviewEventTable,
			} from "./types";

			const DOM_PROP_NAMES = new Set([
				"children",
				"className",
				"defaultValue",
				"id",
				"onBlur",
				"onChange",
				"onClick",
				"onFocus",
				"onInput",
				"onKeyDown",
				"onKeyUp",
				"onMouseDown",
				"onMouseEnter",
				"onMouseLeave",
				"onPointerDown",
				"onPointerMove",
				"onPointerUp",
				"placeholder",
				"role",
				"style",
				"tabIndex",
				"title",
				"value",
			]);

			const PREVIEW_ONLY_PROP_NAMES = new Set([
				"Active",
				"AnchorPoint",
				"AutoButtonColor",
				"AspectRatio",
				"AutomaticSize",
				"BackgroundColor3",
				"BackgroundTransparency",
				"BorderSizePixel",
				"CellPadding",
				"CellSize",
				"ClipsDescendants",
				"CanvasSize",
				"Change",
				"Color",
				"CornerRadius",
				"DominantAxis",
				"Event",
				"FillDirection",
				"FillDirectionMaxCells",
				"Font",
				"FlexMode",
				"GrowRatio",
				"HorizontalAlignment",
				"HorizontalFlex",
				"Id",
				"Image",
				"ImageColor3",
				"ImageTransparency",
				"ItemLineAlignment",
				"LayoutOrder",
				"MaxSize",
				"MaxTextSize",
				"MinSize",
				"MinTextSize",
				"Modal",
				"Name",
				"Padding",
				"PaddingBottom",
				"PaddingBetweenItems",
				"PaddingLeft",
				"PaddingRight",
				"PaddingTop",
				"ParentId",
				"PlaceholderText",
				"Position",
				"Scale",
				"ScrollBarThickness",
				"ScrollingDirection",
				"Selectable",
				"ShrinkRatio",
				"Size",
				"SizeConstraint",
				"SortOrder",
				"StartCorner",
				"Text",
				"TextColor3",
				"TextEditable",
				"TextScaled",
				"TextSize",
				"TextTransparency",
				"TextWrapped",
				"TextXAlignment",
				"TextYAlignment",
				"Thickness",
				"Transparency",
				"VerticalAlignment",
				"VerticalFlex",
				"Visible",
				"Wraps",
				"ZIndex",
				"__previewReactChangeText",
				"__previewReactEventActivated",
				"__previewReactEventFocusLost",
				"__previewReactEventInputBegan",
			]);

			type ResolveOptions = {
				applyComputedLayout?: boolean;
				computed: ComputedRect | null;
				host: HostName;
				nodeId: string;
			};

			export type ResolvedPreviewDomProps = {
				children: React.ReactNode;
				disabled: boolean;
				domProps: ForwardedDomProps & Record<string, unknown>;
				image: unknown;
				text: string | undefined;
			};

			function mergeHandlers<T>(a?: (event: T) => void, b?: (event: T) => void) {
				if (!a) {
					return b;
				}

				if (!b) {
					return a;
				}

				return (event: T) => {
					a(event);
					b(event);
				};
			}

			function pickForwardedDomProps(props: PreviewDomProps): ForwardedDomProps {
				const domProps: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(props)) {
					if (PREVIEW_ONLY_PROP_NAMES.has(key)) {
						continue;
					}

					if (
						key.startsWith("aria-") ||
						key.startsWith("data-") ||
						DOM_PROP_NAMES.has(key)
					) {
						domProps[key] = value;
					}
				}

				return domProps as ForwardedDomProps;
			}

			export function resolvePreviewDomProps(
				props: PreviewDomProps,
				_options: ResolveOptions,
			): ResolvedPreviewDomProps {
				const safeProps = { ...props };
				const {
					Change,
					Event,
					PlaceholderText,
					Text,
					TextEditable,
					Visible,
					Style,
					children,
					className,
					onBlur,
					onChange,
					onClick,
					onKeyDown,
					onPointerDown,
					style,
					__previewReactChangeText,
					__previewReactEventActivated,
					__previewReactEventFocusLost,
					__previewReactEventInputBegan,
					...rest
				} = safeProps as PreviewDomProps & Record<string, unknown>;

				void Style;
				const forwarded = pickForwardedDomProps(rest as PreviewDomProps);
				const activatedHandler =
					typeof __previewReactEventActivated === "function"
						? __previewReactEventActivated
						: typeof Event?.Activated === "function"
							? Event.Activated
							: undefined;
				const focusLostHandler =
					typeof __previewReactEventFocusLost === "function"
						? __previewReactEventFocusLost
						: typeof Event?.FocusLost === "function"
							? Event.FocusLost
							: undefined;
				const inputBeganHandler =
					typeof __previewReactEventInputBegan === "function"
						? __previewReactEventInputBegan
						: typeof Event?.InputBegan === "function"
							? Event.InputBegan
							: undefined;
				const changeTextHandler =
					typeof __previewReactChangeText === "function"
						? __previewReactChangeText
						: typeof Change?.Text === "function"
							? Change.Text
							: undefined;
				const mergedClick = mergeHandlers(
					onClick as ((event: React.MouseEvent<HTMLElement>) => void) | undefined,
					activatedHandler ? () => activatedHandler({}) : undefined,
				);
				const mergedBlur = mergeHandlers(
					onBlur as ((event: React.FocusEvent<HTMLElement>) => void) | undefined,
					focusLostHandler ? () => focusLostHandler({}) : undefined,
				);
				const mergedKeyDown = mergeHandlers(
					onKeyDown as ((event: React.KeyboardEvent<HTMLElement>) => void) | undefined,
					inputBeganHandler ? () => inputBeganHandler({}, { KeyCode: "Return" }) : undefined,
				);
				const mergedPointerDown = mergeHandlers(
					onPointerDown as ((event: React.PointerEvent<HTMLElement>) => void) | undefined,
					inputBeganHandler ? () => inputBeganHandler({}, { UserInputType: "MouseButton1" }) : undefined,
				);
				const mergedChange = mergeHandlers(onChange as ((event: React.ChangeEvent<HTMLElement>) => void) | undefined, changeTextHandler ? (event) => {
					const target = event.currentTarget as HTMLInputElement;
					changeTextHandler(target);
				} : undefined);

				const domProps: Record<string, unknown> = {
					...forwarded,
					className,
					onBlur: mergedBlur,
					onChange: mergedChange,
					onClick: mergedClick,
					onKeyDown: mergedKeyDown,
					onPointerDown: mergedPointerDown,
					placeholder: PlaceholderText,
					readOnly: TextEditable === false,
					value: typeof Text === "string" ? Text : Text,
				};

				if (Visible === false) {
					domProps.hidden = true;
				}

				return {
					children: children ?? null,
					disabled: false,
					domProps: domProps as ForwardedDomProps & Record<string, unknown>,
					image: undefined,
					text: typeof Text === "string" ? Text : Text === undefined || Text === null ? undefined : String(Text),
				};
			}
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetHostsRoot, "components.tsx"),
		`
			import * as React from "react";
			import type { PreviewDomProps } from "./types";

			type HostProps = PreviewDomProps & { children?: React.ReactNode };

			function useForwardedInstanceRef(
				host: string,
				props: HostProps,
				forwardedRef: React.ForwardedRef<HTMLElement>,
			) {
				const elementRef = React.useRef<HTMLElement | null>(null);
				const instanceRef = React.useRef<
					(HTMLElement & {
						IsA(name: string): boolean;
						Text?: string;
					}) | null
				>(null);

				React.useLayoutEffect(() => {
					const element = elementRef.current;
					if (!element) {
						return;
					}

					if (!instanceRef.current) {
						instanceRef.current = Object.assign(element, {
							IsA(name: string) {
								switch (name) {
									case "Instance":
									case "GuiObject":
										return true;
									case "GuiButton":
										return host === "TextButton" || host === "ImageButton";
									case "TextBox":
										return host === "TextBox";
									default:
										return false;
								}
							},
							Text: typeof props.Text === "string" ? props.Text : undefined,
						});
					}

					const instance = instanceRef.current;
					if (!instance) {
						return;
					}

					if (typeof forwardedRef === "function") {
						forwardedRef(instance);
					} else if (forwardedRef) {
						(forwardedRef as React.MutableRefObject<HTMLElement | null>).current = instance;
					}

					return () => {
						if (typeof forwardedRef === "function") {
							forwardedRef(null);
						} else if (forwardedRef) {
							(forwardedRef as React.MutableRefObject<HTMLElement | null>).current = null;
						}
					};
				}, [forwardedRef, host, props.Text]);

				React.useEffect(() => {
					const instance = instanceRef.current;
					if (!instance) {
						return;
					}

					const nextText = typeof props.Text === "string" ? props.Text : "";
					const previousText = instance.Text ?? "";
					instance.Text = nextText;

					if (host === "TextBox" && nextText !== previousText) {
						const changeHandler =
							(typeof props.onChange === "function" ? props.onChange : undefined) ??
							(typeof props.Change?.Text === "function" ? props.Change.Text : undefined);
						if (changeHandler) {
							const input = instance as HTMLInputElement;
							input.value = nextText;
							changeHandler({ currentTarget: input } as React.ChangeEvent<HTMLInputElement>);
						}
					}

					if (host === "TextButton") {
						const clickHandler =
							typeof props.onClick === "function" ? props.onClick : undefined;
						if (clickHandler) {
							clickHandler({ currentTarget: instance } as React.MouseEvent<HTMLElement>);
						}
					}
				}, [host, props.Change, props.Text, props.onChange, props.onClick]);

				return elementRef;
			}

			function createHost(tag: "div" | "button" | "input" | "span") {
				return React.forwardRef<HTMLElement, HostProps>((props, forwardedRef) => {
					const ref = useForwardedInstanceRef(tag === "input" ? "TextBox" : tag === "button" ? "TextButton" : tag === "span" ? "TextLabel" : "Frame", props, forwardedRef);
					const domProps = {
						...props,
						ref,
					} as Record<string, unknown>;
					delete domProps.children;
					return React.createElement(tag, domProps, props.children);
				});
			}

			export const BillboardGui = createHost("div");
			export const CanvasGroup = createHost("div");
			export const Frame = createHost("div");
			export const ImageButton = createHost("button");
			export const ImageLabel = createHost("span");
			export const ScreenGui = createHost("div");
			export const ScrollingFrame = createHost("div");
			export const SurfaceGui = createHost("div");
			export const TextBox = createHost("input");
			export const TextButton = createHost("button");
			export const TextLabel = createHost("span");
			export const VideoFrame = createHost("div");
			export const ViewportFrame = createHost("div");
		`,
		"utf8",
	);

	fs.mkdirSync(path.join(targetRoot, "internal"), { recursive: true });
	fs.mkdirSync(path.join(targetRoot, "layout"), { recursive: true });
	fs.mkdirSync(path.join(targetRoot, "runtime"), { recursive: true });
	fs.mkdirSync(path.join(targetRoot, "style"), { recursive: true });

	fs.writeFileSync(
		path.join(targetRoot, "internal", "previewAttributes.ts"),
		`
			export const PREVIEW_HOST_DATA_ATTRIBUTE = "data-preview-host";
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetRoot, "layout", "model.ts"),
		`
			export type ComputedRect = {
				height: number;
				width: number;
				x: number;
				y: number;
			};
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetRoot, "runtime", "helpers.ts"),
		`
			export function toCssColor(value: unknown) {
				return typeof value === "string" ? value : "transparent";
			}
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetRoot, "style", "textStyles.ts"),
		`
			import * as React from "react";

			export function mapRobloxFont(_font: unknown) {
				return {};
			}

			export function clampPreviewTextSize(
				value: number | undefined,
				_constraints: { maxTextSize?: number; minTextSize?: number } | undefined,
			) {
				return value;
			}

			export function useTextScaleStyle(_options: {
				elementRef: React.RefObject<HTMLElement | null>;
				enabled: boolean;
				fontFamily?: string;
				fontStyle?: React.CSSProperties["fontStyle"];
				fontWeight?: React.CSSProperties["fontWeight"];
				lineHeight?: number | string;
				maxTextSize?: number;
				minTextSize?: number;
				text?: string;
				wrapped?: boolean;
			}) {
				return undefined;
			}
		`,
		"utf8",
	);

	fs.writeFileSync(
		path.join(targetHostsRoot, "types.ts"),
		`
			import type * as React from "react";

			export type PreviewEventTable = {
				Activated?: (...args: unknown[]) => void;
				FocusLost?: (...args: unknown[]) => void;
				InputBegan?: (...args: unknown[]) => void;
			};

			export type ForwardedDomProps = Record<string, unknown>;

			export type HostName = string;

			export type PreviewDomProps = ForwardedDomProps & {
				Change?: {
					Text?: (element: HTMLInputElement) => void;
				};
				Event?: PreviewEventTable;
				Text?: unknown;
				children?: React.ReactNode;
				className?: string;
				onBlur?: unknown;
				onChange?: unknown;
				onClick?: unknown;
				onKeyDown?: unknown;
				onPointerDown?: unknown;
				placeholder?: unknown;
				readOnly?: unknown;
				style?: React.CSSProperties;
				value?: unknown;
				[key: string]: unknown;
			};
		`,
		"utf8",
	);
}

function findDebugNode(
	nodes: Array<{ children?: unknown[]; id?: string }>,
	id: string,
): {
	children?: unknown[];
	id?: string;
	rect?: { height: number; width: number; x: number; y: number };
} | null {
	for (const node of nodes) {
		if (node.id === id) {
			return node as {
				children?: unknown[];
				id?: string;
				rect?: { height: number; width: number; x: number; y: number };
			};
		}

		const childResult = findDebugNode(
			(node.children ?? []) as Array<{ children?: unknown[]; id?: string }>,
			id,
		);
		if (childResult) {
			return childResult;
		}
	}

	return null;
}

function _createComboboxRegressionEntry() {
	return `
		import React from "react";
		import { createPortal } from "react-dom";

		function useMergedRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
			const refsRef = React.useRef(refs);
			refsRef.current = refs;

			return React.useCallback((value: T | null) => {
				for (const ref of refsRef.current) {
					if (!ref) {
						continue;
					}

					if (typeof ref === "function") {
						ref(value);
						continue;
					}

					(ref as React.MutableRefObject<T | null>).current = value;
				}
			}, []);
		}

		function useControllableState<T>({
			defaultValue,
			onChange,
			value,
		}: {
			defaultValue: T;
			onChange?: (next: T) => void;
			value?: T;
		}) {
			const [inner, setInner] = React.useState(defaultValue);
			const controlled = value !== undefined;
			const state = controlled ? value : inner;
			const stateRef = React.useRef(state);
			const controlledRef = React.useRef(controlled);
			const onChangeRef = React.useRef(onChange);

			stateRef.current = state;
			controlledRef.current = controlled;
			onChangeRef.current = onChange;

			const setState = React.useCallback((nextValue: T | ((previous: T) => T)) => {
				const current = stateRef.current;
				const computed =
					typeof nextValue === "function"
						? (nextValue as (previous: T) => T)(current)
						: nextValue;

				if (Object.is(computed, current)) {
					return;
				}

				stateRef.current = computed;

				if (!controlledRef.current) {
					setInner(computed);
				}

				onChangeRef.current?.(computed);
			}, []);

			return [state, setState] as const;
		}

		type PortalContextValue = {
			container?: HTMLElement | null;
			displayOrderBase: number;
		};

		const PortalContext = React.createContext<PortalContextValue>({
			container: undefined,
			displayOrderBase: 0,
		});

		function PortalProvider(props: {
			children?: React.ReactNode;
			container?: HTMLElement | null;
			displayOrderBase?: number;
		}) {
			const value = React.useMemo<PortalContextValue>(
				() => ({
					container: props.container,
					displayOrderBase: props.displayOrderBase ?? 0,
				}),
				[props.container, props.displayOrderBase],
			);

			return (
				<PortalContext.Provider value={value}>
					{props.children}
				</PortalContext.Provider>
			);
		}

		function Portal(props: { children?: React.ReactNode; container?: HTMLElement | null }) {
			const portalContext = React.useContext(PortalContext);
			const container =
				props.container ??
				portalContext.container ??
				(typeof document !== "undefined" ? document.body : null);
			if (!container) {
				return null;
			}

			return createPortal(props.children, container);
		}

		type HandlerTable = Partial<Record<string, (...args: unknown[]) => void>>;

		function isRecord(value: unknown): value is Record<string, unknown> {
			return typeof value === "object" && value !== null;
		}

		function toHandlerTable(value: unknown): HandlerTable | undefined {
			if (!isRecord(value)) {
				return undefined;
			}

			const out: HandlerTable = {};
			for (const [rawKey, candidate] of Object.entries(value)) {
				if (typeof rawKey !== "string" || typeof candidate !== "function") {
					continue;
				}

				out[rawKey] = candidate as (...args: unknown[]) => void;
			}

			return Object.keys(out).length > 0 ? out : undefined;
		}

		function mergeHandlerTable(a?: HandlerTable, b?: HandlerTable) {
			if (!a) {
				return b;
			}

			if (!b) {
				return a;
			}

			const out: HandlerTable = { ...a };
			for (const [rawKey, candidate] of Object.entries(b)) {
				if (typeof rawKey !== "string" || typeof candidate !== "function") {
					continue;
				}

				const af = a[rawKey];
				const bf = candidate;
				out[rawKey] =
					af && bf
						? (...args: unknown[]) => {
								bf(...args);
								af(...args);
							}
						: (bf ?? af)!;
			}

			return out;
		}

		const Slot = React.forwardRef<
			HTMLElement,
			{
				Change?: HandlerTable;
				Event?: HandlerTable;
				children: React.ReactElement<Record<string, unknown>>;
			} & Record<string, unknown>
		>((props, forwardedRef) => {
			const child = props.children;
			const childProps = (child.props ?? {}) as Record<string, unknown>;
			const mergedProps: Record<string, unknown> = { ...props, ...childProps };

			mergedProps.children = childProps.children;

			const slotEvent = toHandlerTable(props.Event);
			const childEvent = toHandlerTable(childProps.Event);
			const slotChange = toHandlerTable(props.Change);
			const childChange = toHandlerTable(childProps.Change);
			const Event = mergeHandlerTable(slotEvent, childEvent);
			const Change = mergeHandlerTable(slotChange, childChange);
			if (Event) {
				mergedProps.Event = Event;
			}
			if (Change) {
				mergedProps.Change = Change;
			}

			const childRef = (child as React.ReactElement & { ref?: React.Ref<unknown> }).ref;
			mergedProps.ref = useMergedRefs(
				childRef,
				forwardedRef as React.Ref<HTMLElement>,
				(props as { ref?: React.Ref<HTMLElement> }).ref,
			);

			return React.cloneElement(child, mergedProps);
		});

		function PreviewTargetShell(props: { children?: React.ReactNode }) {
			const [portalContainer, setPortalContainer] =
				React.useState<HTMLElement | null>(null);

			return (
				<PortalProvider>
					<screengui ref={setPortalContainer}>
						{portalContainer ? (
							<PortalProvider container={portalContainer}>
								{props.children}
							</PortalProvider>
						) : null}
					</screengui>
				</PortalProvider>
			);
		}

		const ComboboxContext = React.createContext<any>(null);

		function useComboboxContext() {
			const context = React.useContext(ComboboxContext);
			if (!context) {
				throw new Error("Missing combobox context.");
			}

			return context;
		}

		function ComboboxRoot(props: {
			children?: React.ReactNode;
			defaultInputValue?: string;
			defaultOpen?: boolean;
			defaultValue?: string;
			onInputValueChange?: (nextInputValue: string) => void;
			onOpenChange?: (nextOpen: boolean) => void;
			onValueChange?: (nextValue: string) => void;
			open?: boolean;
			inputValue?: string;
			value?: string;
		}) {
			const [open, setOpenState] = useControllableState({
				defaultValue: props.defaultOpen ?? false,
				onChange: props.onOpenChange,
				value: props.open,
			});
			const [value, setValueState] = useControllableState({
				defaultValue: props.defaultValue ?? "alpha",
				onChange: props.onValueChange,
				value: props.value,
			});
			const [inputValue, setInputValueState] = useControllableState({
				defaultValue: props.defaultInputValue ?? "",
				onChange: props.onInputValueChange,
				value: props.inputValue,
			});
			const anchorRef = React.useRef<GuiObject>();
			const triggerRef = React.useRef<GuiObject>();
			const inputRef = React.useRef<TextBox>();

			const setOpen = React.useCallback(
				(nextOpen: boolean) => {
					setOpenState(nextOpen);
				},
				[setOpenState],
			);

			const setValue = React.useCallback(
				(nextValue: string) => {
					setValueState(nextValue);
					setInputValueState(nextValue);
				},
				[setInputValueState, setValueState],
			);

			const setInputValue = React.useCallback(
				(nextInputValue: string) => {
					if (nextInputValue === inputValue) {
						return;
					}

					setInputValueState(nextInputValue);
					setOpenState(true);
				},
				[inputValue, setInputValueState, setOpenState],
			);

			const syncInputFromValue = React.useCallback(() => {
				const nextInputValue = value ?? "";
				setInputValueState(nextInputValue);
			}, [setInputValueState, value]);

			React.useEffect(() => {
				if (!open) {
					syncInputFromValue();
				}
			}, [open, syncInputFromValue]);

			const contextValue = React.useMemo(
				() => ({
					anchorRef,
					inputRef,
					inputValue,
					open,
					setInputValue,
					setOpen,
					setValue,
					triggerRef,
					value,
				}),
				[inputValue, open, setInputValue, setOpen, setValue, value],
			);

			return (
				<ComboboxContext.Provider value={contextValue}>
					{props.children}
				</ComboboxContext.Provider>
			);
		}

		function toGuiObject(instance: Instance | undefined) {
			if (!instance || !instance.IsA("GuiObject")) {
				return undefined;
			}

			return instance;
		}

		function toTextBox(instance: Instance | undefined) {
			if (!instance || !instance.IsA("TextBox")) {
				return undefined;
			}

			return instance;
		}

		function ComboboxTrigger(props: { asChild?: boolean; children?: React.ReactElement }) {
			const comboboxContext = useComboboxContext();
			const setTriggerRef = React.useCallback(
				(instance: Instance | undefined) => {
					const previousTrigger = comboboxContext.triggerRef.current;
					const nextTrigger = toGuiObject(instance);

					comboboxContext.triggerRef.current = nextTrigger;

					if (comboboxContext.inputRef.current) {
						return;
					}

					if (nextTrigger) {
						comboboxContext.anchorRef.current = nextTrigger;
						return;
					}

					if (comboboxContext.anchorRef.current === previousTrigger) {
						comboboxContext.anchorRef.current = undefined;
					}
				},
				[
					comboboxContext.anchorRef,
					comboboxContext.inputRef,
					comboboxContext.triggerRef,
				],
			);

			const handleActivated = React.useCallback(() => {
				comboboxContext.setOpen(!comboboxContext.open);
			}, [comboboxContext]);

			const eventHandlers = React.useMemo(
				() => ({
					Activated: handleActivated,
				}),
				[handleActivated],
			);

			if (props.asChild) {
				return (
					<Slot Active={true} Event={eventHandlers} Selectable={false} ref={setTriggerRef}>
						{props.children}
					</Slot>
				);
			}

			return (
				<textbutton
					Active={true}
					AutoButtonColor={false}
					Event={eventHandlers}
					Selectable={false}
					Text="Combobox"
					ref={setTriggerRef}
				>
					{props.children}
				</textbutton>
			);
		}

		function ComboboxValue(props: { asChild?: boolean; placeholder?: string; children?: React.ReactElement }) {
			const comboboxContext = useComboboxContext();
			const selectedValue = comboboxContext.value;
			const resolvedText = React.useMemo(() => {
				if (selectedValue === undefined) {
					return props.placeholder ?? "";
				}

				return selectedValue;
			}, [props.placeholder, selectedValue]);

			if (props.asChild) {
				return (
					<Slot Name="ComboboxValue" Text={resolvedText}>
						{props.children}
					</Slot>
				);
			}

			return <textlabel Text={resolvedText} />;
		}

		function ComboboxInput(props: {
			asChild?: boolean;
			children?: React.ReactElement;
			placeholder?: string;
		}) {
			const comboboxContext = useComboboxContext();
			const setInputRef = React.useCallback(
				(instance: Instance | undefined) => {
					const previousInput = comboboxContext.inputRef.current;
					const nextInput = toTextBox(instance);

					comboboxContext.inputRef.current = nextInput;

					if (nextInput) {
						comboboxContext.anchorRef.current = nextInput;
						return;
					}

					if (comboboxContext.anchorRef.current === previousInput) {
						comboboxContext.anchorRef.current = comboboxContext.triggerRef.current;
					}
				},
				[
					comboboxContext.anchorRef,
					comboboxContext.inputRef,
					comboboxContext.triggerRef,
				],
			);

			const handleTextChanged = React.useCallback(
				(textBox: TextBox) => {
					if (textBox.Text === comboboxContext.inputValue) {
						return;
					}

					comboboxContext.setInputValue(textBox.Text);
				},
				[comboboxContext],
			);

			const sharedProps = {
				Change: {
					Text: handleTextChanged,
				},
				PlaceholderText: props.placeholder ?? "Type to filter",
				Text: comboboxContext.inputValue,
				ref: setInputRef,
			};

			if (props.asChild) {
				return <Slot {...sharedProps}>{props.children}</Slot>;
			}

			return <textbox {...sharedProps} />;
		}

		function ComboboxPortal(props: { children?: React.ReactNode }) {
			return <Portal>{props.children}</Portal>;
		}

		function ComboboxContent(props: {
			children?: React.ReactNode;
			forceMount?: boolean;
		}) {
			const comboboxContext = useComboboxContext();
			const open = comboboxContext.open;
			const forceMount = props.forceMount === true;

			if (!open && !forceMount) {
				return undefined;
			}

			return <frame>{props.children}</frame>;
		}

		export function ComboboxBasicScene() {
			const [value, setValue] = React.useState("alpha");
			const [open, setOpen] = React.useState(false);

			return (
				<frame BackgroundTransparency={1} Size={UDim2.fromOffset(940, 560)}>
					<textlabel
						BackgroundTransparency={1}
						Size={UDim2.fromOffset(920, 28)}
						Text="Combobox: type-to-filter + enforced selection"
					/>
					<textlabel
						BackgroundTransparency={1}
						Position={UDim2.fromOffset(0, 34)}
						Size={UDim2.fromOffset(920, 24)}
						Text={\`Controlled open: \${open ? "true" : "false"} | value: \${value}\`}
					/>

					<frame
						BackgroundTransparency={1}
						Position={UDim2.fromOffset(0, 76)}
						Size={UDim2.fromOffset(900, 220)}
					>
						<ComboboxRoot onOpenChange={setOpen} onValueChange={setValue} value={value}>
							<frame
								BackgroundTransparency={1}
								LayoutOrder={1}
								Size={UDim2.fromOffset(860, 86)}
							>
								<ComboboxTrigger asChild>
									<textbutton Size={UDim2.fromOffset(320, 40)} Text="">
										<textlabel
											BackgroundTransparency={1}
											Position={UDim2.fromOffset(12, 0)}
											Size={UDim2.fromOffset(84, 40)}
											Text="Selected"
										/>
										<ComboboxValue asChild placeholder="Select option">
											<textlabel
												BackgroundTransparency={1}
												Position={UDim2.fromOffset(88, 0)}
												Size={UDim2.fromOffset(212, 40)}
											/>
										</ComboboxValue>
									</textbutton>
								</ComboboxTrigger>

								<ComboboxInput asChild placeholder="Type alpha, beta, gamma...">
									<textbox
										BackgroundTransparency={0}
										BorderSizePixel={0}
										Size={UDim2.fromOffset(320, 34)}
										TextXAlignment={Enum.TextXAlignment.Left}
									/>
								</ComboboxInput>
							</frame>

							<ComboboxPortal>
								<ComboboxContent>
									<frame />
								</ComboboxContent>
							</ComboboxPortal>
						</ComboboxRoot>
					</frame>
				</frame>
			);
		}

		export const preview = {
			render: () => (
				<PreviewTargetShell>
					<ComboboxBasicScene />
				</PreviewTargetShell>
			),
			title: "Combobox Basic",
		} as const;
	`;
}

function _createComboboxRegressionEntryWithRealRuntime() {
	return `
		import React from "react";
		import {
			Portal,
			PreviewTargetShell,
			Presence,
			Slot,
			useControllableState,
		} from "../vendor/preview-runtime/bridge.ts";

		type ComboboxContextValue = {
			anchorRef: React.MutableRefObject<GuiObject | undefined>;
			inputRef: React.MutableRefObject<TextBox | undefined>;
			inputValue: string;
			open: boolean;
			setInputValue: (next: string) => void;
			setOpen: (next: boolean) => void;
			setValue: (next: string) => void;
			triggerRef: React.MutableRefObject<GuiObject | undefined>;
			value: string | undefined;
		};

		const ComboboxContext = React.createContext<ComboboxContextValue | null>(null);

		function useComboboxContext() {
			const context = React.useContext(ComboboxContext);
			if (!context) {
				throw new Error("Missing combobox context.");
			}

			return context;
		}

		function toGuiObject(instance: Instance | undefined) {
			if (!instance || !instance.IsA("GuiObject")) {
				return undefined;
			}

			return instance;
		}

		function toTextBox(instance: Instance | undefined) {
			if (!instance || !instance.IsA("TextBox")) {
				return undefined;
			}

			return instance;
		}

		function ComboboxRoot(props: {
			children?: React.ReactNode;
			defaultInputValue?: string;
			defaultOpen?: boolean;
			defaultValue?: string;
			onInputValueChange?: (next: string) => void;
			onOpenChange?: (next: boolean) => void;
			onValueChange?: (next: string) => void;
			open?: boolean;
			inputValue?: string;
			value?: string;
		}) {
			const [open, setOpenState] = useControllableState<boolean>({
				value: props.open,
				defaultValue: props.defaultOpen ?? false,
				onChange: props.onOpenChange,
			});
			const [value, setValueState] = useControllableState<string | undefined>({
				value: props.value,
				defaultValue: props.defaultValue,
				onChange: (nextValue) => {
					if (nextValue !== undefined) {
						props.onValueChange?.(nextValue);
					}
				},
			});
			const [inputValue, setInputValueState] = useControllableState<string>({
				value: props.inputValue,
				defaultValue: props.defaultInputValue ?? "",
				onChange: props.onInputValueChange,
			});
			const anchorRef = React.useRef<GuiObject>();
			const triggerRef = React.useRef<GuiObject>();
			const inputRef = React.useRef<TextBox>();

			React.useEffect(() => {
				if (open) {
					return;
				}

				setInputValueState(value ?? "");
			}, [open, setInputValueState, value]);

			const contextValue = React.useMemo(
				() => ({
					anchorRef,
					inputRef,
					inputValue,
					open,
					setInputValue: setInputValueState,
					setOpen: setOpenState,
					setValue: (nextValue: string) => {
						setValueState(nextValue);
						setInputValueState(nextValue);
					},
					triggerRef,
					value,
				}),
				[inputValue, open, setInputValueState, setOpenState, setValueState, value],
			);

			return (
				<ComboboxContext.Provider value={contextValue}>
					{props.children}
				</ComboboxContext.Provider>
			);
		}

		function ComboboxTrigger(props: {
			asChild?: boolean;
			children?: React.ReactElement;
		}) {
			const comboboxContext = useComboboxContext();
			const setTriggerRef = React.useCallback(
				(instance: Instance | undefined) => {
					const previousTrigger = comboboxContext.triggerRef.current;
					const nextTrigger = toGuiObject(instance);

					comboboxContext.triggerRef.current = nextTrigger;

					if (comboboxContext.inputRef.current) {
						return;
					}

					if (nextTrigger) {
						comboboxContext.anchorRef.current = nextTrigger;
						return;
					}

					if (comboboxContext.anchorRef.current === previousTrigger) {
						comboboxContext.anchorRef.current = undefined;
					}
				},
				[
					comboboxContext.anchorRef,
					comboboxContext.inputRef,
					comboboxContext.triggerRef,
				],
			);
			const handleActivated = React.useCallback(() => {
				comboboxContext.setOpen(!comboboxContext.open);
			}, [comboboxContext]);
			const handleInputBegan = React.useCallback(
				(_rbx: GuiObject, inputObject: InputObject) => {
					if (
						inputObject.KeyCode === Enum.KeyCode.Return ||
						inputObject.KeyCode === Enum.KeyCode.Space
					) {
						comboboxContext.setOpen(!comboboxContext.open);
					}
				},
				[comboboxContext],
			);
			const eventHandlers = React.useMemo(
				() => ({
					Activated: handleActivated,
					InputBegan: handleInputBegan,
				}),
				[handleActivated, handleInputBegan],
			);

			if (props.asChild) {
				return (
					<Slot Active={true} Event={eventHandlers} Selectable={false} ref={setTriggerRef}>
						{props.children}
					</Slot>
				);
			}

			return (
				<textbutton
					Active={true}
					AutoButtonColor={false}
					Event={eventHandlers}
					Selectable={false}
					Text="Combobox"
					ref={setTriggerRef}
				/>
			);
		}

		function ComboboxValue(props: {
			asChild?: boolean;
			placeholder?: string;
			children?: React.ReactElement;
		}) {
			const comboboxContext = useComboboxContext();
			const selectedValue = comboboxContext.value;
			const resolvedText = React.useMemo(() => {
				if (selectedValue === undefined) {
					return props.placeholder ?? "";
				}

				return selectedValue;
			}, [props.placeholder, selectedValue]);

			if (props.asChild) {
				return (
					<Slot Name="ComboboxValue" Text={resolvedText}>
						{props.children}
					</Slot>
				);
			}

			return <textlabel Text={resolvedText} />;
		}

		function ComboboxInput(props: {
			asChild?: boolean;
			children?: React.ReactElement;
			placeholder?: string;
		}) {
			const comboboxContext = useComboboxContext();
			const setInputRef = React.useCallback(
				(instance: Instance | undefined) => {
					const previousInput = comboboxContext.inputRef.current;
					const nextInput = toTextBox(instance);

					comboboxContext.inputRef.current = nextInput;

					if (nextInput) {
						comboboxContext.anchorRef.current = nextInput;
						return;
					}

					if (comboboxContext.anchorRef.current === previousInput) {
						comboboxContext.anchorRef.current = comboboxContext.triggerRef.current;
					}
				},
				[
					comboboxContext.anchorRef,
					comboboxContext.inputRef,
					comboboxContext.triggerRef,
				],
			);
			const handleTextChanged = React.useCallback(
				(textBox: TextBox) => {
					if (textBox.Text === comboboxContext.inputValue) {
						return;
					}

					comboboxContext.setInputValue(textBox.Text);
				},
				[comboboxContext],
			);
			const sharedProps = {
				Active: true,
				ClearTextOnFocus: false,
				Change: {
					Text: handleTextChanged,
				},
				PlaceholderText: props.placeholder ?? "Type to filter",
				Selectable: true,
				Text: comboboxContext.inputValue,
				TextEditable: true,
				ref: setInputRef,
			};

			if (props.asChild) {
				return <Slot {...sharedProps}>{props.children}</Slot>;
			}

			return <textbox {...sharedProps} />;
		}

		function ComboboxPortal(props: { children?: React.ReactNode }) {
			return <Portal>{props.children}</Portal>;
		}

		function ComboboxContent(props: {
			children?: React.ReactNode;
			forceMount?: boolean;
		}) {
			const comboboxContext = useComboboxContext();
			const open = comboboxContext.open;
			const forceMount = props.forceMount === true;

			if (!open && !forceMount) {
				return undefined;
			}

			return forceMount ? (
				<frame>{props.children}</frame>
			) : (
				<Presence present={open} render={() => <frame>{props.children}</frame>} />
			);
		}

		export function ComboboxBasicScene() {
			const [value, setValue] = React.useState("alpha");
			const [open, setOpen] = React.useState(false);

			return (
				<frame BackgroundTransparency={1} Size={UDim2.fromOffset(940, 560)}>
					<textlabel
						BackgroundTransparency={1}
						Size={UDim2.fromOffset(920, 28)}
						Text="Combobox: type-to-filter + enforced selection"
					/>
					<textlabel
						BackgroundTransparency={1}
						Position={UDim2.fromOffset(0, 34)}
						Size={UDim2.fromOffset(920, 24)}
						Text={\`Controlled open: \${open ? "true" : "false"} | value: \${value}\`}
					/>

					<frame
						BackgroundTransparency={1}
						Position={UDim2.fromOffset(0, 76)}
						Size={UDim2.fromOffset(900, 220)}
					>
						<ComboboxRoot onOpenChange={setOpen} onValueChange={setValue} value={value}>
							<frame
								BackgroundTransparency={1}
								LayoutOrder={1}
								Size={UDim2.fromOffset(860, 86)}
							>
								<ComboboxTrigger asChild>
									<textbutton Size={UDim2.fromOffset(320, 40)} Text="">
										<textlabel
											BackgroundTransparency={1}
											Position={UDim2.fromOffset(12, 0)}
											Size={UDim2.fromOffset(84, 40)}
											Text="Selected"
										/>
										<ComboboxValue asChild placeholder="Select option">
											<textlabel
												BackgroundTransparency={1}
												Position={UDim2.fromOffset(88, 0)}
												Size={UDim2.fromOffset(212, 40)}
											/>
										</ComboboxValue>
									</textbutton>
								</ComboboxTrigger>

								<ComboboxInput asChild placeholder="Type alpha, beta, gamma...">
									<textbox
										BackgroundTransparency={0}
										BorderSizePixel={0}
										Size={UDim2.fromOffset(320, 34)}
										TextXAlignment={Enum.TextXAlignment.Left}
									/>
								</ComboboxInput>
							</frame>

							<ComboboxPortal>
								<ComboboxContent>
									<frame />
								</ComboboxContent>
							</ComboboxPortal>
						</ComboboxRoot>
					</frame>
				</frame>
			);
		}

		export const preview = {
			render: () => (
				<PreviewTargetShell>
					<ComboboxBasicScene />
				</PreviewTargetShell>
			),
			title: "Combobox Basic",
		} as const;
	`;
}

describe("createPreviewHeadlessSession", () => {
	it("starts with skipped executions and only runs selected entries on demand", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/ComponentEntry.loom.tsx": `
				export function ComponentEntry() {
					return <frame Id="component-root"><textlabel Id="component-label" Text="Component" /></frame>;
				}

				export const preview = {
					entry: ComponentEntry,
				};
			`,
			"src/HarnessEntry.loom.tsx": `
				export function HarnessCard() {
					return <frame Id="harness-card"><textlabel Id="harness-label" Text="Harness" /></frame>;
				}

				export const preview = {
					render: () => <HarnessCard />,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			const initialSnapshot = session.getSnapshot();
			const componentId = initialSnapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("ComponentEntry.loom.tsx"),
			)?.id;
			const harnessId = initialSnapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("HarnessEntry.loom.tsx"),
			)?.id;

			expect(componentId).toBeTruthy();
			expect(harnessId).toBeTruthy();
			if (!componentId || !harnessId) {
				throw new Error("Expected component and harness entries to exist.");
			}

			expect(initialSnapshot.execution.summary).toEqual({
				error: 0,
				pass: 0,
				selectedEntryCount: 0,
				total: 2,
				warning: 0,
			});
			expect(initialSnapshot.execution.entries[componentId]).toMatchObject({
				render: {
					status: "skipped",
				},
				severity: "skipped",
			});
			expect(initialSnapshot.execution.entries[harnessId]).toMatchObject({
				render: {
					status: "skipped",
				},
				severity: "skipped",
			});

			await session.run({ entryIds: [componentId] });
			const selectedSnapshot = session.getSnapshot();
			expect(selectedSnapshot.execution.summary).toEqual({
				error: 0,
				pass: 1,
				selectedEntryCount: 1,
				total: 2,
				warning: 0,
			});
			expect(selectedSnapshot.execution.entries[componentId]).toMatchObject({
				render: {
					status: "rendered",
				},
				severity: "pass",
			});
			expect(selectedSnapshot.execution.entries[harnessId]).toMatchObject({
				render: {
					status: "skipped",
				},
				severity: "skipped",
			});
		} finally {
			session.dispose();
		}
	});

	it("reproduces the combobox basic scene runtime failure through headless entry execution", async () => {
		const packageRoot = createFixtureTempPreviewPackage("combobox-regression");

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			const snapshot = await session.run();
			const entryId = snapshot.workspaceIndex.entries[0]?.id;
			expect(entryId).toBeTruthy();
			if (!entryId) {
				throw new Error("Expected combobox regression entry to exist.");
			}

			expect(snapshot.entries[entryId]?.descriptor.relativePath).toBe(
				"ComboboxBasicScene.loom.tsx",
			);
			expect(snapshot.entries[entryId]?.descriptor.targetName).toBe(
				"playground",
			);
			expect(snapshot.execution.entries[entryId]).toMatchObject({
				render: {
					status: "rendered",
				},
				renderIssue: null,
			});
			expect(snapshot.entries[entryId]?.descriptor.status).toBe("ready");

			const comboboxTrace = (
				globalThis as typeof globalThis & {
					__loomComboboxTrace?: string[];
				}
			).__loomComboboxTrace;
			expect(comboboxTrace).toBeTruthy();
			if (!comboboxTrace) {
				throw new Error("Expected combobox trace to be recorded.");
			}

			expect(comboboxTrace.slice(0, 8)).toEqual([
				"render-shell:root-ref:set",
				"render-shell:portal:waiting",
				"target-shell:root-ref:set",
				"target-shell:portal:waiting",
				"render-shell:portal:ready",
				"effect:closed-sync:->alpha",
				"set:input:alpha",
				"target-shell:portal:ready",
			]);
			expect(comboboxTrace).toEqual(
				expect.arrayContaining(["target-shell:portal:ready"]),
			);
			expect(
				comboboxTrace.filter((step) => step === "target-shell:root-ref:set")
					.length,
			).toBe(1);
		} finally {
			session.dispose();
		}
	});

	it("reruns entries after clearing runtime issues from previous runs", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/RenderFailure.loom.tsx": `
				export function RenderFailure() {
					throw new Error("render failed");
				}

				export const preview = {
					entry: RenderFailure,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			let snapshot = await session.run();
			const entryId = snapshot.workspaceIndex.entries[0]?.id;
			expect(entryId).toBeTruthy();
			if (!entryId) {
				throw new Error("Expected render failure entry to exist.");
			}

			expect(snapshot.execution.entries[entryId]).toMatchObject({
				render: {
					status: "render_failed",
				},
				severity: "error",
			});

			snapshot = await session.run({ entryIds: [entryId] });
			expect(snapshot.execution.entries[entryId]).toMatchObject({
				render: {
					status: "render_failed",
				},
				severity: "error",
			});
		} finally {
			session.dispose();
		}
	});

	it("uses the current workspace entry state for later runs", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/DynamicEntry.loom.tsx": `
				export function DynamicEntry() {
					return <frame Id="dynamic-root" />;
				}

				export const preview = {
					entry: DynamicEntry,
				};
			`,
		});
		const sourceFilePath = path.join(
			packageRoot,
			"src",
			"DynamicEntry.loom.tsx",
		);

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			const entryId = session.getSnapshot().workspaceIndex.entries[0]?.id;
			expect(entryId).toBeTruthy();
			if (!entryId) {
				throw new Error("Expected dynamic entry to exist.");
			}

			fs.writeFileSync(sourceFilePath, "export const value = 1;\n", "utf8");
			session.engine.invalidateSourceFiles([sourceFilePath]);

			await session.run({ entryIds: [entryId] });
			const snapshot = session.getSnapshot();
			expect(snapshot.entries[entryId]?.descriptor.status).toBe(
				"needs_harness",
			);
			expect(snapshot.execution.entries[entryId]).toMatchObject({
				render: {
					status: "skipped",
				},
				severity: "error",
			});
		} finally {
			session.dispose();
		}
	});
	it("renders preview.entry and preview.render entries into execution results", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/ComponentEntry.loom.tsx": `
				export function ComponentEntry() {
					return <frame Id="component-root"><textlabel Id="component-label" Text="Component" /></frame>;
				}

				export const preview = {
					entry: ComponentEntry,
				};
			`,
			"src/HarnessEntry.loom.tsx": `
				export function HarnessCard() {
					return <frame Id="harness-card"><textlabel Id="harness-label" Text="Harness" /></frame>;
				}

				export const preview = {
					render: () => <HarnessCard />,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			await session.run();
			const snapshot = session.getSnapshot();
			const componentId = snapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("ComponentEntry.loom.tsx"),
			)?.id;
			const harnessId = snapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("HarnessEntry.loom.tsx"),
			)?.id;

			expect(componentId).toBeTruthy();
			expect(harnessId).toBeTruthy();
			if (!componentId || !harnessId) {
				throw new Error("Expected component and harness entries to exist.");
			}

			expect(snapshot.execution.entries[componentId]).toMatchObject({
				render: {
					status: "rendered",
				},
				severity: "pass",
			});
			expect(snapshot.execution.entries[harnessId]).toMatchObject({
				render: {
					status: "rendered",
				},
				severity: "pass",
			});
		} finally {
			session.dispose();
		}
	});

	it("records load and render failures as runtime-blocking execution results", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/LoadFailure.loom.tsx": `
				throw new Error("load failed");

				export function LoadFailure() {
					return <frame />;
				}

				export const preview = {
					entry: LoadFailure,
				};
			`,
			"src/RenderFailure.loom.tsx": `
				export function RenderFailure() {
					throw new Error("render failed");
				}

				export const preview = {
					entry: RenderFailure,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			await session.run();
			const snapshot = session.getSnapshot();
			const loadEntryId = snapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("LoadFailure.loom.tsx"),
			)?.id;
			const renderEntryId = snapshot.workspaceIndex.entries.find((entry) =>
				entry.relativePath.endsWith("RenderFailure.loom.tsx"),
			)?.id;

			expect(loadEntryId).toBeTruthy();
			expect(renderEntryId).toBeTruthy();
			if (!loadEntryId || !renderEntryId) {
				throw new Error("Expected load and render failure entries to exist.");
			}

			expect(snapshot.execution.entries[loadEntryId]).toMatchObject({
				loadIssue: expect.objectContaining({
					code: "MODULE_LOAD_ERROR",
				}),
				render: {
					status: "load_failed",
				},
				severity: "error",
			});
			expect(snapshot.execution.entries[renderEntryId]).toMatchObject({
				render: {
					status: "render_failed",
				},
				renderIssue: expect.objectContaining({
					code: "RENDER_ERROR",
				}),
				severity: "error",
			});
			expect(snapshot.entries[loadEntryId]?.descriptor.status).toBe(
				"blocked_by_runtime",
			);
			expect(snapshot.entries[renderEntryId]?.descriptor.status).toBe(
				"blocked_by_runtime",
			);
		} finally {
			session.dispose();
		}
	});

	it("captures degraded host warnings, layout debug, and viewport metadata", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/ViewportEntry.loom.tsx": `
				export function ViewportEntry() {
					return (
						<screengui Id="viewport-screen">
							<viewportframe Id="viewport-frame" />
						</screengui>
					);
				}

				export const preview = {
					entry: ViewportEntry,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			await session.run();
			const snapshot = session.getSnapshot();
			const entryId = snapshot.workspaceIndex.entries[0]?.id;
			expect(entryId).toBeTruthy();
			if (!entryId) {
				throw new Error("Expected viewport entry to exist.");
			}

			expect(snapshot.execution.entries[entryId]).toMatchObject({
				degradedHostWarnings: [
					expect.objectContaining({
						code: "DEGRADED_HOST_RENDER",
						target: "ViewportFrame",
					}),
				],
				render: {
					status: "rendered",
				},
				severity: "warning",
				viewport: {
					height: 600,
					ready: true,
					source: "window-fallback",
					width: 800,
				},
				warningState: {
					degradedTargets: ["ViewportFrame"],
					fidelity: "degraded",
				},
			});
			expect(snapshot.execution.entries[entryId]?.layoutDebug).toEqual(
				expect.objectContaining({
					viewport: {
						height: 600,
						width: 800,
					},
				}),
			);
			expect(snapshot.entries[entryId]?.descriptor.status).toBe("ready");
		} finally {
			session.dispose();
		}
	});

	it("waits for delayed effect mounts before finalizing layout debug", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/DelayedEntry.loom.tsx": `
				import React from "react";

				export function DelayedEntry() {
					const [ready, setReady] = React.useState(false);

					React.useEffect(() => {
						const timeoutId = window.setTimeout(() => {
							setReady(true);
						}, 0);

						return () => {
							window.clearTimeout(timeoutId);
						};
					}, []);

					if (!ready) {
						return null;
					}

					return (
						<screengui Id="delayed-screen">
							<frame Id="delayed-frame">
								<textlabel Id="delayed-label" Text="Delayed label" />
							</frame>
						</screengui>
					);
				}

				export const preview = {
					entry: DelayedEntry,
				};
			`,
		});

		let session: Awaited<
			ReturnType<typeof createPreviewHeadlessSession>
		> | null = null;

		try {
			session = await createPreviewHeadlessSession({ cwd: packageRoot });
			await session.run();
			const snapshot = session.getSnapshot();
			const entryId = snapshot.workspaceIndex.entries[0]?.id;
			expect(entryId).toBeTruthy();
			if (!entryId) {
				throw new Error("Expected delayed entry to exist.");
			}

			expect(snapshot.execution.entries[entryId]?.render.status).toBe(
				"rendered",
			);
			expect(
				String(
					JSON.stringify(snapshot.execution.entries[entryId]?.layoutDebug),
				).includes("delayed-label"),
			).toBe(true);
		} finally {
			session?.dispose();
		}
	});

	it("captures layout modifier semantics in headless layout debug", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/LayoutSemanticsEntry.loom.tsx": `
				export function LayoutSemanticsEntry() {
					return (
						<screengui Id="layout-screen">
							<frame Id="list-frame" Size={UDim2.fromOffset(140, 120)}>
								<uipadding
									PaddingBottom={new UDim(0, 10)}
									PaddingLeft={new UDim(0, 10)}
									PaddingRight={new UDim(0, 10)}
									PaddingTop={new UDim(0, 10)}
								/>
								<uilistlayout
									FillDirection={Enum.FillDirection.Vertical}
									HorizontalAlignment={Enum.HorizontalAlignment.Center}
									SortOrder={Enum.SortOrder.LayoutOrder}
									VerticalFlex={Enum.UIFlexAlignment.Fill}
								/>
								<frame Id="flex-one" LayoutOrder={1} Size={UDim2.fromOffset(120, 20)}>
									<uiflexitem FlexMode={Enum.UIFlexMode.Grow} GrowRatio={1} />
								</frame>
								<frame Id="flex-two" LayoutOrder={2} Size={UDim2.fromOffset(120, 20)}>
									<uiflexitem FlexMode={Enum.UIFlexMode.Grow} GrowRatio={2} />
								</frame>
							</frame>
							<frame Id="grid-frame" Position={UDim2.fromOffset(0, 140)} Size={UDim2.fromOffset(220, 140)}>
								<uigridlayout
									CellPadding={UDim2.fromOffset(10, 5)}
									CellSize={UDim2.fromOffset(50, 20)}
									FillDirection={Enum.FillDirection.Horizontal}
									FillDirectionMaxCells={3}
									HorizontalAlignment={Enum.HorizontalAlignment.Center}
									StartCorner={Enum.StartCorner.TopLeft}
									VerticalAlignment={Enum.VerticalAlignment.Center}
								/>
								<frame Id="grid-1" Size={UDim2.fromOffset(50, 20)} />
								<frame Id="grid-2" Size={UDim2.fromOffset(50, 20)} />
								<frame Id="grid-3" Size={UDim2.fromOffset(50, 20)} />
								<frame Id="grid-4" Size={UDim2.fromOffset(50, 20)} />
							</frame>
							<frame Id="constrained-box" Position={UDim2.fromOffset(240, 0)} Size={UDim2.fromOffset(50, 80)}>
								<uisizeconstraint MaxSize={[160, 120]} MinSize={[100, 40]} />
								<uiaspectratioconstraint AspectRatio={2} DominantAxis={Enum.DominantAxis.Width} />
							</frame>
						</screengui>
					);
				}

				export const preview = {
					entry: LayoutSemanticsEntry,
				};
			`,
		});

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			await session.run();
			const snapshot = session.getSnapshot();
			const entryId = snapshot.workspaceIndex.entries[0]?.id;
			expect(entryId).toBeTruthy();
			if (!entryId) {
				throw new Error("Expected layout semantics entry to exist.");
			}

			const execution = snapshot.execution.entries[entryId];
			expect(execution?.render.status).toBe("rendered");
			expect(execution?.severity).toBe("pass");

			const roots = execution?.layoutDebug?.roots ?? [];
			expect(findDebugNode(roots, "flex-one")?.rect).toEqual({
				height: 40,
				width: 120,
				x: 10,
				y: 10,
			});
			expect(findDebugNode(roots, "flex-two")?.rect).toEqual({
				height: 60,
				width: 120,
				x: 10,
				y: 50,
			});
			expect(findDebugNode(roots, "grid-1")?.rect).toEqual({
				height: 20,
				width: 50,
				x: 25,
				y: 187.5,
			});
			expect(findDebugNode(roots, "grid-4")?.rect).toEqual({
				height: 20,
				width: 50,
				x: 25,
				y: 212.5,
			});
			expect(findDebugNode(roots, "constrained-box")?.rect).toEqual({
				height: 50,
				width: 100,
				x: 240,
				y: 0,
			});
		} finally {
			session.dispose();
		}
	});

	it("restores temporary preview globals after headless execution", async () => {
		const packageRoot = createTempPreviewPackage({
			"src/RestoreProbe.loom.tsx": `
				export function RestoreProbe() {
					return <frame Id="restore-probe" />;
				}

				export const preview = {
					entry: RestoreProbe,
				};
			`,
		});
		const probeKey = "__loom_headless_restore_probe__";
		const globalPrototypeHost = Object.getPrototypeOf(globalThis);
		const initialGlobalPrototypeParent = globalPrototypeHost
			? Object.getPrototypeOf(globalPrototypeHost)
			: null;

		expect(probeKey in globalThis).toBe(false);

		const session = await createPreviewHeadlessSession({ cwd: packageRoot });

		try {
			expect(session.getSnapshot().workspaceIndex.entries).toHaveLength(1);
		} finally {
			session.dispose();
		}

		expect(probeKey in globalThis).toBe(false);
		expect(
			globalPrototypeHost
				? Object.getPrototypeOf(globalPrototypeHost)
				: initialGlobalPrototypeParent,
		).toBe(initialGlobalPrototypeParent);
	});
});
