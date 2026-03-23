export type LayoutEngineModuleOrPath =
	| string
	| URL
	| Request
	| Response
	| Blob
	| BufferSource
	| WebAssembly.Module;

export type LayoutEngineInitInput =
	| {
			module_or_path?:
				| LayoutEngineModuleOrPath
				| Promise<LayoutEngineModuleOrPath>;
	  }
	| LayoutEngineModuleOrPath
	| Promise<LayoutEngineModuleOrPath>
	| undefined;

export interface LayoutSession {
	applyNodes(nodes: unknown[]): void;
	computeDirty(): unknown;
	dispose(): void;
	removeNodes(nodeIds: string[]): void;
	setViewport(viewport: { height: number; width: number }): void;
}

export default function initLayoutEngine(
	input?: LayoutEngineInitInput,
): Promise<void>;

export function createLayoutSession(): LayoutSession;

export function compute_layout(
	raw_tree: unknown,
	viewport_width: number,
	viewport_height: number,
): unknown;
