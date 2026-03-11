import { Enum } from "./Enum";
import { installPreviewRuntimePolyfills } from "./polyfills";
import { RunService } from "./RunService";
import { game, getTweenInfoConstructor, workspace } from "./services";
import { task } from "./task";

export interface PreviewRuntimeGlobalTarget {
	Enum?: typeof Enum;
	RunService?: typeof RunService;
	TweenInfo?: typeof import("./services").TweenInfo;
	game?: typeof game;
	print?: (...args: unknown[]) => void;
	task?: typeof task;
	tostring?: (value: unknown) => string;
	workspace?: typeof workspace;
}

export function installPreviewRuntimeGlobals(
	target: PreviewRuntimeGlobalTarget = globalThis as PreviewRuntimeGlobalTarget,
) {
	installPreviewRuntimePolyfills(target as typeof globalThis);

	if (target.Enum === undefined) {
		target.Enum = Enum;
	}

	if (target.RunService === undefined) {
		target.RunService = RunService;
	}

	if (target.game === undefined) {
		target.game = game;
	}

	if (target.task === undefined) {
		target.task = task;
	}

	if (target.TweenInfo === undefined) {
		target.TweenInfo = getTweenInfoConstructor();
	}

	if (target.workspace === undefined) {
		target.workspace = workspace;
	}

	return target;
}

export default installPreviewRuntimeGlobals;
