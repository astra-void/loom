import { Enum } from "./Enum";
import { previewRuntimeBaseGlobals } from "./helpers";
import { installPreviewRuntimePolyfills } from "./polyfills";
import { RunService } from "./RunService";
import { game, getTweenInfoConstructor, workspace } from "./services";
import { task } from "./task";

export const previewRuntimeGlobalValues = Object.freeze({
	...previewRuntimeBaseGlobals,
	Enum,
	RunService,
	TweenInfo: getTweenInfoConstructor(),
	game,
	task,
	workspace,
} as const);

export type PreviewRuntimeGlobalValues = typeof previewRuntimeGlobalValues;
export type PreviewRuntimeGlobalName = keyof PreviewRuntimeGlobalValues;
export type PreviewRuntimeGlobalTarget = {
	-readonly [K in PreviewRuntimeGlobalName]?: PreviewRuntimeGlobalValues[K];
};

export const previewRuntimeGlobalNames = Object.freeze(
	Object.keys(previewRuntimeGlobalValues) as PreviewRuntimeGlobalName[],
);

export function installPreviewRuntimeGlobals(
	target: PreviewRuntimeGlobalTarget = globalThis as PreviewRuntimeGlobalTarget,
) {
	installPreviewRuntimePolyfills(target as typeof globalThis);
	const runtimeTarget = target as Record<PreviewRuntimeGlobalName, unknown>;

	for (const globalName of previewRuntimeGlobalNames) {
		if (runtimeTarget[globalName] === undefined) {
			runtimeTarget[globalName] = previewRuntimeGlobalValues[globalName];
		}
	}

	return target;
}

export default installPreviewRuntimeGlobals;
