import { Enum } from "./Enum";
import { Color3, math, Vector3, warn } from "./helpers";
import { installPreviewRuntimePolyfills } from "./polyfills";
import { RunService } from "./RunService";
import { game, getTweenInfoConstructor, workspace } from "./services";
import { task } from "./task";

export interface PreviewRuntimeGlobalTarget {
	Color3?: typeof Color3;
	Enum?: typeof Enum;
	RunService?: typeof RunService;
	TweenInfo?: typeof import("./services").TweenInfo;
	Vector3?: typeof Vector3;
	game?: typeof game;
	math?: typeof math;
	print?: (...args: unknown[]) => void;
	task?: typeof task;
	tostring?: (value: unknown) => string;
	warn?: typeof warn;
	workspace?: typeof workspace;
}

export function installPreviewRuntimeGlobals(
	target: PreviewRuntimeGlobalTarget = globalThis as PreviewRuntimeGlobalTarget,
) {
	installPreviewRuntimePolyfills(target as typeof globalThis);

	if (target.Color3 === undefined) {
		target.Color3 = Color3;
	}

	if (target.Enum === undefined) {
		target.Enum = Enum;
	}

	if (target.RunService === undefined) {
		target.RunService = RunService;
	}

	if (target.Vector3 === undefined) {
		target.Vector3 = Vector3;
	}

	if (target.game === undefined) {
		target.game = game;
	}

	if (target.math === undefined) {
		target.math = math;
	}

	if (target.task === undefined) {
		target.task = task;
	}

	if (target.TweenInfo === undefined) {
		target.TweenInfo = getTweenInfoConstructor();
	}

	if (target.warn === undefined) {
		target.warn = warn;
	}

	if (target.workspace === undefined) {
		target.workspace = workspace;
	}

	return target;
}

export default installPreviewRuntimeGlobals;
