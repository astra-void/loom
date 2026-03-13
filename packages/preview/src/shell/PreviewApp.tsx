import type {
	PreviewDiagnostic,
	PreviewEntryDescriptor,
	PreviewEntryPayload,
	PreviewEntryStatus,
} from "@loom-dev/preview-engine";
import {
	areViewportsEqual,
	clearPreviewRuntimeIssues,
	createViewportSize,
	createWindowViewport,
	isViewportLargeEnough,
	LayoutProvider,
	measureElementViewport,
	type PreviewRuntimeIssue,
	pickViewport,
	setPreviewRuntimeIssueContext,
	subscribePreviewRuntimeIssues,
	type ViewportSize,
} from "@loom-dev/preview-runtime";
import React from "react";
import {
	createPreviewLoadIssue,
	createPreviewRenderIssue,
	createPreviewRenderNode,
	describePreviewWarningState,
	getPreviewReadyWarningState,
	isPreviewBlockingIssue,
	type PreviewModule,
	type PreviewReadyWarningState,
} from "../execution/shared";
import { PreviewThemeControl } from "./theme";

type PreviewAppProps = {
	entries: PreviewEntryDescriptor[];
	entryPayloads?: Record<string, PreviewEntryPayload>;
	initialSelectedId?: string;
	loadEntry: (id: string) => Promise<LoadedPreviewEntry>;
	projectName: string;
};

type PreviewCanvasProps = {
	entry: PreviewEntryDescriptor;
	isDebugMode: boolean;
	module: PreviewModule;
	onRenderError: (error: unknown | null) => void;
	warningState: PreviewReadyWarningState;
};

type PreviewNodeRendererProps = {
	entry: PreviewEntryDescriptor;
	module: PreviewModule;
};

type PreviewErrorBoundaryProps = {
	children: React.ReactNode;
	onError: (error: unknown | null) => void;
};

type PreviewErrorBoundaryState = {
	errorMessage: string | null;
};

type LoadedPreviewEntry = {
	module: PreviewModule;
	payload?: PreviewEntryPayload;
};

type RuntimeIssueRenderMeta = {
	key: string;
	occurrence: number;
};

type SidebarFileNode = {
	entry: PreviewEntryDescriptor;
	hasWarning: boolean;
	id: string;
	kind: "file";
	name: string;
};

type SidebarFolderNode = {
	children: SidebarTreeNode[];
	id: string;
	kind: "folder";
	name: string;
};

type SidebarTargetNode = {
	children: SidebarTreeNode[];
	entryCount: number;
	id: string;
	name: string;
};

type SidebarTreeNode = SidebarFolderNode | SidebarFileNode;

type SidebarTree = {
	folderIds: Set<string>;
	targets: SidebarTargetNode[];
};

type MutableSidebarBranchNode = {
	files: SidebarFileNode[];
	folders: Map<string, MutableSidebarBranchNode>;
	id: string;
	name: string;
};

class PreviewErrorBoundary extends React.Component<
	PreviewErrorBoundaryProps,
	PreviewErrorBoundaryState
> {
	constructor(props: PreviewErrorBoundaryProps) {
		super(props);
		this.state = {
			errorMessage: null,
		};
	}

	static getDerivedStateFromError(error: unknown): PreviewErrorBoundaryState {
		return {
			errorMessage:
				error instanceof Error
					? error.message
					: "Unknown preview render error.",
		};
	}

	componentDidCatch(error: unknown) {
		this.props.onError(error);
	}

	render() {
		if (this.state.errorMessage) {
			return (
				<div className="preview-empty">
					<p className="preview-empty-eyebrow">Render error</p>
					<h2>Preview render failed.</h2>
					<p>{this.state.errorMessage}</p>
				</div>
			);
		}

		return this.props.children;
	}
}

function getInitialSelectedId(
	entries: PreviewEntryDescriptor[],
	explicitSelectedId?: string,
) {
	if (
		explicitSelectedId &&
		entries.some((entry) => entry.id === explicitSelectedId)
	) {
		return explicitSelectedId;
	}

	if (typeof window !== "undefined") {
		const searchParams = new URLSearchParams(window.location.search);
		const selectedPath = searchParams.get("path");
		if (selectedPath && entries.some((entry) => entry.id === selectedPath)) {
			return selectedPath;
		}
	}

	return entries[0]?.id;
}

function readPreviewDefinition(module: PreviewModule) {
	const preview = module.preview;

	if (!preview || typeof preview !== "object") {
		return undefined;
	}

	return preview;
}

function getRuntimeIssueFingerprint(issue: PreviewRuntimeIssue) {
	return [
		issue.entryId,
		issue.code,
		issue.kind,
		issue.phase,
		issue.relativeFile,
		issue.summary,
		issue.details ?? "",
		issue.symbol ?? "",
		issue.codeFrame ?? "",
		issue.importChain?.join(">") ?? "",
	].join("::");
}

function createRuntimeIssueRenderMeta(issues: PreviewRuntimeIssue[]) {
	const counts = new Map<string, number>();
	const renderMeta = new Map<PreviewRuntimeIssue, RuntimeIssueRenderMeta>();

	for (const issue of issues) {
		const fingerprint = getRuntimeIssueFingerprint(issue);
		const occurrence = (counts.get(fingerprint) ?? 0) + 1;
		counts.set(fingerprint, occurrence);
		renderMeta.set(issue, {
			key: occurrence === 1 ? fingerprint : `${fingerprint}::${occurrence}`,
			occurrence,
		});
	}

	return renderMeta;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getRenderModeLabel(entry: PreviewEntryDescriptor) {
	if (entry.renderTarget.kind === "harness") {
		return "preview.render";
	}

	if (
		entry.selection.kind === "explicit" &&
		entry.selection.contract === "preview.entry"
	) {
		return "preview.entry";
	}

	if (
		entry.renderTarget.kind === "component" &&
		entry.renderTarget.exportName === "default"
	) {
		return "default export";
	}

	if (entry.renderTarget.kind === "component") {
		return entry.renderTarget.exportName;
	}

	return "none";
}

function getStatusLabel(status: PreviewEntryStatus) {
	switch (status) {
		case "ready":
			return "ready";
		case "ambiguous":
			return "ambiguous";
		case "blocked_by_layout":
			return "blocked by layout";
		case "blocked_by_runtime":
			return "blocked by runtime";
		case "blocked_by_transform":
			return "blocked by transform";
		case "needs_harness":
			return "needs harness";
	}
}

function formatCandidateExports(candidates: string[]) {
	return candidates.join(", ");
}

function _uniqueSorted(values: Iterable<string>) {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isBlockingIssue(
	issue:
		| Pick<PreviewDiagnostic, "blocking" | "severity">
		| Pick<PreviewRuntimeIssue, "blocking" | "severity">,
) {
	return isPreviewBlockingIssue(issue);
}

function getReadyWarningState(
	statusDetails: PreviewEntryDescriptor["statusDetails"] | undefined,
	diagnostics: PreviewDiagnostic[],
	runtimeIssues: PreviewRuntimeIssue[],
): PreviewReadyWarningState {
	return getPreviewReadyWarningState(statusDetails, diagnostics, runtimeIssues);
}

function describeWarningState(warningState: PreviewReadyWarningState) {
	return describePreviewWarningState(warningState);
}

function getPrimaryDiscoveryDiagnostic(
	discoveryDiagnostics: PreviewDiagnostic[],
) {
	const priority: Record<string, number> = {
		AMBIGUOUS_COMPONENT_EXPORTS: 0,
		PREVIEW_RENDER_MISSING: 1,
		MISSING_EXPLICIT_PREVIEW_CONTRACT: 2,
		NO_COMPONENT_EXPORTS: 3,
		DECLARATION_ONLY_BOUNDARY: 4,
		UNRESOLVED_IMPORT: 5,
	};

	return [...discoveryDiagnostics].sort((left, right) => {
		const priorityDelta =
			(priority[left.code] ?? Number.MAX_SAFE_INTEGER) -
			(priority[right.code] ?? Number.MAX_SAFE_INTEGER);
		if (priorityDelta !== 0) {
			return priorityDelta;
		}

		return left.summary.localeCompare(right.summary);
	})[0];
}

function getDiscoveryDiagnostic(
	discoveryDiagnostics: PreviewDiagnostic[],
	code: string,
) {
	return discoveryDiagnostics.find((diagnostic) => diagnostic.code === code);
}

function getNeedsHarnessReasonBody(entry: PreviewEntryDescriptor) {
	if (entry.renderTarget.kind !== "none") {
		return undefined;
	}

	if (entry.renderTarget.reason === "ambiguous-exports") {
		return `Automatic selection found multiple component exports: ${formatCandidateExports(
			entry.renderTarget.candidates ?? entry.candidateExportNames,
		)}. Add \`preview.entry\` or \`preview.render\` to pick the intended preview target.`;
	}

	return "No renderable exported component was found. Add `preview.entry` or `preview.render` for composed demos.";
}

function getEntryEmptyState(
	entry: PreviewEntryDescriptor,
	discoveryDiagnostics: PreviewDiagnostic[],
) {
	const primaryDiscoveryDiagnostic =
		getPrimaryDiscoveryDiagnostic(discoveryDiagnostics);
	const missingExplicitDiagnostic = getDiscoveryDiagnostic(
		discoveryDiagnostics,
		"MISSING_EXPLICIT_PREVIEW_CONTRACT",
	);
	const previewRenderMissingDiagnostic = getDiscoveryDiagnostic(
		discoveryDiagnostics,
		"PREVIEW_RENDER_MISSING",
	);

	if (entry.status === "needs_harness" || entry.status === "ambiguous") {
		if (missingExplicitDiagnostic) {
			return {
				body: missingExplicitDiagnostic.summary,
				eyebrow: "Needs harness",
				title: "Explicit preview contract is required.",
			};
		}

		if (previewRenderMissingDiagnostic) {
			return {
				body:
					`${previewRenderMissingDiagnostic.summary} ` +
					(getNeedsHarnessReasonBody(entry) ??
						"Add `preview.entry` or `preview.render` to make the preview target explicit."),
				eyebrow: "Needs harness",
				title: "The preview export is incomplete.",
			};
		}

		if (
			entry.renderTarget.kind === "none" &&
			entry.renderTarget.reason === "ambiguous-exports"
		) {
			return {
				body: getNeedsHarnessReasonBody(entry),
				eyebrow: "Needs harness",
				title: "Multiple exported components match this file.",
			};
		}

		if (
			entry.renderTarget.kind === "none" &&
			entry.renderTarget.reason === "no-component-export"
		) {
			return {
				body: getNeedsHarnessReasonBody(entry),
				eyebrow: "Needs harness",
				title: "This file is not directly previewable yet.",
			};
		}

		return {
			body:
				primaryDiscoveryDiagnostic?.summary ??
				"Add `export const preview = { entry: Component }` or `render: () => ...` when the file needs explicit harnessing.",
			eyebrow: "Needs harness",
			title: "This file is not directly previewable yet.",
		};
	}
}

function isLoadableEntryStatus(status: PreviewEntryStatus) {
	return (
		status === "ready" ||
		status === "blocked_by_transform" ||
		status === "blocked_by_runtime" ||
		status === "blocked_by_layout"
	);
}

function hasSidebarWarningIndicator(entry: PreviewEntryDescriptor) {
	return (
		entry.statusDetails.kind === "ready" &&
		(entry.statusDetails.fidelity === "degraded" ||
			(entry.statusDetails.warningCodes?.length ?? 0) > 0)
	);
}

function getRelativePathSegments(relativePath: string) {
	return relativePath.split("/").filter(Boolean);
}

function getEntryFileName(relativePath: string) {
	const pathSegments = getRelativePathSegments(relativePath);
	return pathSegments[pathSegments.length - 1] ?? relativePath;
}

function createSidebarTargetId(targetName: string) {
	return `target:${targetName}`;
}

function createSidebarFolderId(targetName: string, folderPath: string) {
	return `folder:${targetName}:${folderPath}`;
}

function createMutableSidebarBranchNode(
	id: string,
	name: string,
): MutableSidebarBranchNode {
	return {
		files: [],
		folders: new Map(),
		id,
		name,
	};
}

function sortSidebarTreeNodes(nodes: SidebarTreeNode[]) {
	return [...nodes].sort((left, right) => {
		if (left.kind !== right.kind) {
			return left.kind === "folder" ? -1 : 1;
		}

		const nameComparison = left.name.localeCompare(right.name);
		if (nameComparison !== 0) {
			return nameComparison;
		}

		if (left.kind === "file" && right.kind === "file") {
			return left.entry.relativePath.localeCompare(right.entry.relativePath);
		}

		return left.id.localeCompare(right.id);
	});
}

function finalizeSidebarBranchNode(
	branch: MutableSidebarBranchNode,
): SidebarTreeNode[] {
	const folderNodes = [...branch.folders.values()].map((folder) => ({
		children: finalizeSidebarBranchNode(folder),
		id: folder.id,
		kind: "folder" as const,
		name: folder.name,
	}));

	return sortSidebarTreeNodes([...folderNodes, ...branch.files]);
}

function buildSidebarTree(entries: PreviewEntryDescriptor[]): SidebarTree {
	const folderIds = new Set<string>();
	const targets = new Map<
		string,
		MutableSidebarBranchNode & {
			entryCount: number;
		}
	>();

	for (const entry of entries) {
		let target = targets.get(entry.targetName);
		if (!target) {
			target = {
				...createMutableSidebarBranchNode(
					createSidebarTargetId(entry.targetName),
					entry.targetName,
				),
				entryCount: 0,
			};
			targets.set(entry.targetName, target);
		}

		target.entryCount += 1;

		const pathSegments = getRelativePathSegments(entry.relativePath);
		const fileName = getEntryFileName(entry.relativePath);
		const folderSegments = pathSegments.slice(0, -1);

		let parent = target as MutableSidebarBranchNode;
		let folderPath = "";
		for (const folderName of folderSegments) {
			folderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
			let folder = parent.folders.get(folderName);
			if (!folder) {
				const folderId = createSidebarFolderId(entry.targetName, folderPath);
				folder = createMutableSidebarBranchNode(folderId, folderName);
				parent.folders.set(folderName, folder);
				folderIds.add(folderId);
			}

			parent = folder;
		}

		parent.files.push({
			entry,
			hasWarning: hasSidebarWarningIndicator(entry),
			id: `file:${entry.id}`,
			kind: "file",
			name: fileName,
		});
	}

	return {
		folderIds,
		targets: [...targets.values()]
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((target) => ({
				children: finalizeSidebarBranchNode(target),
				entryCount: target.entryCount,
				id: target.id,
				name: target.name,
			})),
	};
}

function getSelectedEntryFolderIds(entry: PreviewEntryDescriptor) {
	const folderIds: string[] = [];
	const folderSegments = getRelativePathSegments(entry.relativePath).slice(
		0,
		-1,
	);
	let folderPath = "";

	for (const folderName of folderSegments) {
		folderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
		folderIds.push(createSidebarFolderId(entry.targetName, folderPath));
	}

	return folderIds;
}

function createPreviewNode(
	entry: PreviewEntryDescriptor,
	module: PreviewModule,
) {
	return createPreviewRenderNode(entry, module);
}

function PreviewNodeRenderer(props: PreviewNodeRendererProps) {
	return createPreviewNode(props.entry, props.module);
}

function usePreviewViewport() {
	const viewportRef = React.useRef<HTMLDivElement | null>(null);
	const [viewport, setViewport] = React.useState<ViewportSize>(() =>
		createWindowViewport(),
	);
	const lastStableViewportRef = React.useRef<ViewportSize>(viewport);

	React.useLayoutEffect(() => {
		const element = viewportRef.current;
		if (!element) {
			return;
		}

		const update = (nextMeasuredViewport?: ViewportSize | null) => {
			const measuredViewport =
				nextMeasuredViewport ?? measureElementViewport(element);
			const nextViewport = pickViewport(
				[measuredViewport, lastStableViewportRef.current],
				createWindowViewport(),
			);

			if (isViewportLargeEnough(nextViewport)) {
				lastStableViewportRef.current = nextViewport;
			}

			setViewport((previous) =>
				areViewportsEqual(previous, nextViewport) ? previous : nextViewport,
			);
		};

		update();

		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver((entries) => {
				const entry =
					entries.find((candidate) => candidate.target === element) ??
					entries[0];
				update(
					createViewportSize(
						entry?.contentRect.width,
						entry?.contentRect.height,
					),
				);
			});
			observer.observe(element);
			return () => {
				observer.disconnect();
			};
		}

		const onWindowResize = () => {
			update();
		};

		window.addEventListener("resize", onWindowResize);
		return () => {
			window.removeEventListener("resize", onWindowResize);
		};
	}, []);

	return {
		viewport,
		viewportRef,
	};
}

function PreviewCanvas(props: PreviewCanvasProps) {
	const preview = readPreviewDefinition(props.module);
	const { viewport, viewportRef } = usePreviewViewport();
	const subtitle =
		props.entry.renderTarget.kind === "harness"
			? "Custom harness"
			: props.entry.renderTarget.kind === "component" &&
					props.entry.renderTarget.usesPreviewProps
				? "Component render with preview.props"
				: "Component render";

	return (
		<div className="preview-canvas">
			<div className="canvas-meta">
				<div>
					<p className="meta-label">Target</p>
					<p className="meta-value">{props.entry.targetName}</p>
				</div>
				<div>
					<p className="meta-label">Render</p>
					<p className="meta-value">{getRenderModeLabel(props.entry)}</p>
				</div>
				<div>
					<p className="meta-label">Mode</p>
					<p className="meta-value">{subtitle}</p>
				</div>
				<div>
					<p className="meta-label">Title</p>
					<p className="meta-value">{preview?.title ?? props.entry.title}</p>
				</div>
			</div>
			{props.warningState.fidelity === "degraded" ||
			props.warningState.warningCodes.length > 0 ? (
				<aside aria-live="polite" className="preview-warning">
					<p className="preview-warning-eyebrow">Fidelity warning</p>
					<p className="preview-warning-title">
						Rendered with degraded fidelity.
					</p>
					<p className="preview-warning-body">
						{describeWarningState(props.warningState)}
					</p>
				</aside>
			) : undefined}
			<div className="preview-stage">
				<div
					className="preview-stage-viewport"
					data-debug-mode={props.isDebugMode ? "true" : undefined}
					data-preview-stage-height={viewport.height}
					data-preview-stage-width={viewport.width}
					ref={viewportRef}
				>
					<LayoutProvider
						viewportHeight={viewport.height}
						viewportWidth={viewport.width}
					>
						<PreviewErrorBoundary
							key={props.entry.id}
							onError={props.onRenderError}
						>
							<PreviewNodeRenderer entry={props.entry} module={props.module} />
						</PreviewErrorBoundary>
					</LayoutProvider>
				</div>
			</div>
		</div>
	);
}

export function PreviewApp(props: PreviewAppProps) {
	const { loadEntry } = props;
	const [selectedId, setSelectedId] = React.useState(() =>
		getInitialSelectedId(props.entries, props.initialSelectedId),
	);
	const [isDebugMode, setIsDebugMode] = React.useState(false);
	const [loadedEntry, setLoadedEntry] = React.useState<
		LoadedPreviewEntry | undefined
	>();
	const [loadIssue, setLoadIssue] = React.useState<PreviewRuntimeIssue | null>(
		null,
	);
	const [renderIssue, setRenderIssue] =
		React.useState<PreviewRuntimeIssue | null>(null);
	const [runtimeIssues, setRuntimeIssues] = React.useState<
		PreviewRuntimeIssue[]
	>([]);
	const selectedEntryRef = React.useRef<PreviewEntryDescriptor | undefined>(
		undefined,
	);
	const runtimeIssueRenderMeta = React.useMemo(
		() => createRuntimeIssueRenderMeta(runtimeIssues),
		[runtimeIssues],
	);
	const selectedEntry =
		props.entries.find((entry) => entry.id === selectedId) ?? props.entries[0];
	const selectedEntryPayload =
		(selectedEntry ? props.entryPayloads?.[selectedEntry.id] : undefined) ??
		loadedEntry?.payload;
	const selectedEntryDiscoveryDiagnostics =
		selectedEntry == null
			? []
			: (selectedEntryPayload?.diagnostics.filter(
					(diagnostic) => diagnostic.phase === "discovery",
				) ?? []);
	const selectedEntryDiagnostics =
		selectedEntryPayload?.diagnostics.filter(
			(diagnostic) => diagnostic.phase !== "discovery",
		) ?? [];
	const selectedEntryBlockingDiagnostics = selectedEntryDiagnostics.filter(
		(diagnostic) => isBlockingIssue(diagnostic),
	);
	const selectedEntryWarningState = React.useMemo(
		() =>
			getReadyWarningState(
				selectedEntryPayload?.descriptor.statusDetails ??
					selectedEntry?.statusDetails,
				selectedEntryDiagnostics,
				runtimeIssues,
			),
		[
			runtimeIssues,
			selectedEntry?.statusDetails,
			selectedEntryDiagnostics,
			selectedEntryPayload?.descriptor.statusDetails,
		],
	);
	const selectedEntryRuntimeWarningCount = runtimeIssues.filter(
		(issue) => !isBlockingIssue(issue),
	).length;
	const blockingRuntimeIssueCount = runtimeIssues.filter((issue) =>
		isBlockingIssue(issue),
	).length;
	const blockingIssueCount =
		selectedEntryBlockingDiagnostics.length +
		blockingRuntimeIssueCount +
		(renderIssue ? 1 : 0) +
		(loadIssue ? 1 : 0);
	const selectedEntryWarningCount = Math.max(
		selectedEntryWarningState.warningCodes.length,
		selectedEntryDiagnostics.filter(
			(diagnostic) => !isBlockingIssue(diagnostic),
		).length + selectedEntryRuntimeWarningCount,
	);
	const emptyState = selectedEntry
		? getEntryEmptyState(selectedEntry, selectedEntryDiscoveryDiagnostics)
		: undefined;
	const sidebarTree = React.useMemo(
		() => buildSidebarTree(props.entries),
		[props.entries],
	);
	const selectedEntryFolderIds = React.useMemo(
		() =>
			selectedEntry ? new Set(getSelectedEntryFolderIds(selectedEntry)) : null,
		[selectedEntry],
	);
	const selectedEntryFileName = selectedEntry
		? getEntryFileName(selectedEntry.relativePath)
		: undefined;
	const selectedEntryId = selectedEntry?.id;
	const selectedEntryStatus = selectedEntry?.status;
	const selectedEntrySourceFilePath = selectedEntry?.sourceFilePath;
	const selectedEntryRelativePath = selectedEntry?.relativePath;
	const selectedEntryTargetName = selectedEntry?.targetName;
	const [collapsedFolderIds, setCollapsedFolderIds] = React.useState<
		Set<string>
	>(() => new Set());
	selectedEntryRef.current = selectedEntry;

	React.useEffect(() => {
		if (!selectedEntryId || typeof window === "undefined") {
			return;
		}

		const url = new URL(window.location.href);
		url.searchParams.set("path", selectedEntryId);
		window.history.replaceState({}, "", url);
	}, [selectedEntryId]);

	React.useEffect(() => {
		const unsubscribe = subscribePreviewRuntimeIssues((issues) => {
			setRuntimeIssues(issues);
		});

		return () => {
			unsubscribe();
		};
	}, []);

	React.useEffect(() => {
		clearPreviewRuntimeIssues();
		setPreviewRuntimeIssueContext(
			selectedEntryId &&
				selectedEntrySourceFilePath &&
				selectedEntryRelativePath &&
				selectedEntryTargetName
				? {
						entryId: selectedEntryId,
						file: selectedEntrySourceFilePath,
						relativeFile: selectedEntryRelativePath,
						target: selectedEntryTargetName,
					}
				: null,
		);
		setLoadIssue(null);
		setRenderIssue(null);

		return () => {
			setPreviewRuntimeIssueContext(null);
		};
	}, [
		selectedEntryId,
		selectedEntryRelativePath,
		selectedEntrySourceFilePath,
		selectedEntryTargetName,
	]);

	React.useEffect(() => {
		if (
			!selectedEntryId ||
			!selectedEntryStatus ||
			!isLoadableEntryStatus(selectedEntryStatus)
		) {
			setLoadedEntry(undefined);
			setLoadIssue(null);
			setRenderIssue(null);
			return;
		}

		let cancelled = false;
		setLoadedEntry(undefined);
		setLoadIssue(null);
		setRenderIssue(null);

		loadEntry(selectedEntryId)
			.then((entryResult) => {
				if (!cancelled) {
					setLoadedEntry(entryResult);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					const currentSelectedEntry = selectedEntryRef.current;
					if (currentSelectedEntry) {
						setLoadIssue(createPreviewLoadIssue(currentSelectedEntry, error));
					}
				}
			});

		return () => {
			cancelled = true;
		};
	}, [loadEntry, selectedEntryId, selectedEntryStatus]);

	React.useEffect(() => {
		setCollapsedFolderIds((previous) => {
			let changed = false;
			const next = new Set<string>();

			for (const folderId of previous) {
				if (sidebarTree.folderIds.has(folderId)) {
					next.add(folderId);
				} else {
					changed = true;
				}
			}

			return changed ? next : previous;
		});
	}, [sidebarTree]);

	React.useEffect(() => {
		if (!selectedEntry) {
			return;
		}

		const selectedFolderIds = getSelectedEntryFolderIds(selectedEntry);
		if (selectedFolderIds.length === 0) {
			return;
		}

		setCollapsedFolderIds((previous) => {
			let changed = false;
			const next = new Set(previous);

			for (const folderId of selectedFolderIds) {
				if (next.delete(folderId)) {
					changed = true;
				}
			}

			return changed ? next : previous;
		});
	}, [selectedEntry]);

	const renderSidebarNodes = (
		nodes: SidebarTreeNode[],
		depth: number,
	): React.ReactNode =>
		nodes.map((node) => {
			const indentStyle = {
				paddingInlineStart: `${8 + depth * 14}px`,
			} satisfies React.CSSProperties;

			if (node.kind === "folder") {
				const isCollapsed = collapsedFolderIds.has(node.id);
				const isSelectedBranch = selectedEntryFolderIds?.has(node.id) ?? false;
				return (
					<div className="sidebar-tree-node" key={node.id}>
						<button
							aria-expanded={!isCollapsed}
							className={`sidebar-folder-row ${isCollapsed ? "is-collapsed" : ""} ${
								isSelectedBranch ? "is-active-branch" : ""
							}`}
							onClick={() => {
								setCollapsedFolderIds((previous) => {
									const next = new Set(previous);
									if (isSelectedBranch && !next.has(node.id)) {
										return previous;
									}
									if (next.has(node.id)) {
										next.delete(node.id);
									} else {
										next.add(node.id);
									}
									return next;
								});
							}}
							style={indentStyle}
							type="button"
						>
							<span aria-hidden="true" className="sidebar-tree-arrow" />
							<span className="sidebar-folder-label">{node.name}</span>
						</button>
						{isCollapsed ? undefined : (
							<div className="sidebar-tree-children">
								{renderSidebarNodes(node.children, depth + 1)}
							</div>
						)}
					</div>
				);
			}

			const isSelected = node.entry.id === selectedEntry?.id;
			const statusDescription = getStatusLabel(node.entry.status);

			return (
				<button
					aria-current={isSelected ? "page" : undefined}
					className={`sidebar-file-row ${isSelected ? "is-selected" : ""}`}
					key={node.id}
					onClick={() =>
						React.startTransition(() => setSelectedId(node.entry.id))
					}
					style={indentStyle}
					title={`${node.entry.relativePath} (${statusDescription}${node.hasWarning ? ", warning" : ""})`}
					type="button"
				>
					<span className="sidebar-file-name">{node.name}</span>
					<span aria-hidden="true" className="sidebar-file-indicators">
						<span
							className="sidebar-status-dot"
							data-status={node.entry.status}
						/>
						{node.hasWarning ? (
							<span className="sidebar-warning-dot" />
						) : undefined}
					</span>
				</button>
			);
		});

	return (
		<main className="preview-shell">
			<aside className="preview-sidebar">
				<div className="sidebar-header">
					<div className="sidebar-brand">
						<p className="sidebar-eyebrow">Explorer</p>
						<h1>{props.projectName}</h1>
					</div>
					<p className="sidebar-header-note">
						{props.entries.length} preview file(s) across{" "}
						{sidebarTree.targets.length} target(s).
					</p>
				</div>
				<nav aria-label="Preview entries" className="sidebar-tree">
					{sidebarTree.targets.map((target) => (
						<section className="sidebar-target-group" key={target.id}>
							<div className="sidebar-target-row">
								<span className="sidebar-target-label">{target.name}</span>
								<span className="sidebar-target-count">
									{target.entryCount}
								</span>
							</div>
							<div className="sidebar-tree-children">
								{renderSidebarNodes(target.children, 1)}
							</div>
						</section>
					))}
				</nav>
			</aside>

			<section className="preview-main">
				{selectedEntry ? (
					<>
						<header className="preview-header">
							<div className="preview-header-copy">
								<p className="section-eyebrow">Selected preview</p>
								<div className="preview-header-title">
									<h2>{selectedEntryFileName}</h2>
									<span
										className={`status-pill status-${selectedEntry.status}`}
									>
										{getStatusLabel(selectedEntry.status)}
									</span>
								</div>
								<p className="preview-header-path">
									{selectedEntry.relativePath}
								</p>
								<div className="preview-header-meta">
									<span className="meta-pill">{selectedEntry.targetName}</span>
									{selectedEntry.title !== selectedEntryFileName ? (
										<span className="meta-pill">{selectedEntry.title}</span>
									) : undefined}
									<span className="meta-pill">
										{selectedEntry.selection.kind === "explicit"
											? "Explicit preview contract"
											: "Unresolved preview contract"}
									</span>
								</div>
								{selectedEntryWarningState.fidelity === "degraded" ||
								selectedEntryWarningState.warningCodes.length > 0 ? (
									<p className="header-warning-copy">
										{describeWarningState(selectedEntryWarningState)}
									</p>
								) : undefined}
							</div>
							<div className="preview-toolbar">
								<div className="preview-toolbar-group">
									<PreviewThemeControl />
									<label className="debug-toggle">
										<input
											checked={isDebugMode}
											onChange={(event) => setIsDebugMode(event.target.checked)}
											type="checkbox"
										/>
										<span>Debug mode</span>
									</label>
								</div>
							</div>
						</header>

						<section className="preview-card">
							{selectedEntry.status === "ready" ? (
								loadedEntry ? (
									selectedEntryBlockingDiagnostics.length > 0 ? (
										<div className="preview-empty">
											<p className="preview-empty-eyebrow">Diagnostics</p>
											<h2>Transform diagnostics are blocking this preview.</h2>
											<p>
												Fix the unsupported patterns below, then save again.
											</p>
										</div>
									) : (
										<PreviewCanvas
											entry={selectedEntry}
											isDebugMode={isDebugMode}
											module={loadedEntry.module}
											onRenderError={(error) => {
												if (error == null) {
													setRenderIssue(null);
													return;
												}

												setRenderIssue(
													createPreviewRenderIssue(selectedEntry, error),
												);
											}}
											warningState={selectedEntryWarningState}
										/>
									)
								) : loadIssue ? (
									<div className="preview-empty">
										<p className="preview-empty-eyebrow">Load error</p>
										<h2>Preview module failed to load.</h2>
										<p>{loadIssue.summary}</p>
									</div>
								) : (
									<div className="preview-empty">
										<p className="preview-empty-eyebrow">Loading</p>
										<h2>Preparing transformed source.</h2>
										<p>
											The selected `@rbxts/react` module is being compiled into
											the web preview runtime.
										</p>
									</div>
								)
							) : selectedEntry.status === "blocked_by_transform" ? (
								loadedEntry ? (
									<div className="preview-empty">
										<p className="preview-empty-eyebrow">Transform blocked</p>
										<h2>This preview is blocked by transform mode.</h2>
										<p>
											Fix the blocking diagnostics below or opt into a
											non-default transform mode.
										</p>
									</div>
								) : loadIssue ? (
									<div className="preview-empty">
										<p className="preview-empty-eyebrow">Load error</p>
										<h2>Preview diagnostics could not be loaded.</h2>
										<p>{loadIssue.summary}</p>
									</div>
								) : (
									<div className="preview-empty">
										<p className="preview-empty-eyebrow">Loading</p>
										<h2>Preparing transform diagnostics.</h2>
										<p>
											The selected entry is blocked, but its diagnostics are
											still loading.
										</p>
									</div>
								)
							) : selectedEntry.status === "blocked_by_runtime" ||
								selectedEntry.status === "blocked_by_layout" ? (
								<div className="preview-empty">
									<p className="preview-empty-eyebrow">Runtime blocked</p>
									<h2>Preview execution is blocked.</h2>
									<p>Review the runtime and layout issues below.</p>
								</div>
							) : (
								<div className="preview-empty">
									<p className="preview-empty-eyebrow">{emptyState?.eyebrow}</p>
									<h2>{emptyState?.title}</h2>
									<p>{emptyState?.body}</p>
								</div>
							)}
						</section>

						<section className="diagnostics-card">
							<div className="diagnostics-header">
								<div>
									<p className="section-eyebrow">Diagnostics</p>
									<h3>Source analysis</h3>
								</div>
								<div className="diagnostics-summary">
									<span className="diagnostics-summary-item">
										{blockingIssueCount} blocking
									</span>
									<span className="diagnostics-summary-item">
										{selectedEntryWarningCount} warnings
									</span>
									<span className="diagnostics-summary-item">
										{selectedEntryDiscoveryDiagnostics.length} notes
									</span>
									{renderIssue ? (
										<span className="diagnostics-summary-item">
											render error
										</span>
									) : undefined}
									{loadIssue ? (
										<span className="diagnostics-summary-item">load error</span>
									) : undefined}
								</div>
							</div>
							{selectedEntryDiagnostics.length === 0 &&
							selectedEntryDiscoveryDiagnostics.length === 0 &&
							runtimeIssues.length === 0 &&
							!renderIssue &&
							!loadIssue ? (
								<p className="diagnostics-empty">
									No diagnostics for this entry.
								</p>
							) : (
								<div className="diagnostics-list">
									{selectedEntryDiagnostics.map((diagnostic) => (
										<article
											className="diagnostic-item"
											key={`${diagnostic.relativeFile}:${diagnostic.code}:${diagnostic.summary}`}
										>
											<p className="diagnostic-code">{diagnostic.code}</p>
											<p className="diagnostic-message">{diagnostic.summary}</p>
											<p className="diagnostic-location">
												{diagnostic.relativeFile}
											</p>
										</article>
									))}
									{selectedEntryDiscoveryDiagnostics.map((diagnostic) => (
										<article
											className="diagnostic-item diagnostic-item-discovery"
											key={`${diagnostic.relativeFile}:${diagnostic.code}:${diagnostic.summary}`}
										>
											<p className="diagnostic-code">{diagnostic.code}</p>
											<p className="diagnostic-message">{diagnostic.summary}</p>
											<p className="diagnostic-location">
												{diagnostic.relativeFile}
											</p>
										</article>
									))}
									{runtimeIssues.map((issue) => {
										const renderMeta = runtimeIssueRenderMeta.get(issue);
										return (
											<article
												className={`diagnostic-item diagnostic-item-runtime ${
													isBlockingIssue(issue)
														? ""
														: "diagnostic-item-warning"
												}`.trim()}
												key={
													renderMeta?.key ?? getRuntimeIssueFingerprint(issue)
												}
											>
												<p className="diagnostic-code">{issue.code}</p>
												<p className="diagnostic-message">{issue.summary}</p>
												<p className="diagnostic-location">
													{issue.relativeFile}:{issue.kind}:
													{renderMeta?.occurrence ?? 1}
												</p>
											</article>
										);
									})}
									{loadIssue ? (
										<article className="diagnostic-item diagnostic-item-runtime">
											<p className="diagnostic-code">{loadIssue.code}</p>
											<p className="diagnostic-message">{loadIssue.summary}</p>
										</article>
									) : undefined}
									{renderIssue ? (
										<article className="diagnostic-item diagnostic-item-runtime">
											<p className="diagnostic-code">{renderIssue.code}</p>
											<p className="diagnostic-message">
												{renderIssue.summary}
											</p>
										</article>
									) : undefined}
								</div>
							)}
						</section>
					</>
				) : (
					<section className="preview-card preview-card-empty">
						<div className="preview-empty">
							<p className="preview-empty-eyebrow">Empty project</p>
							<h2>No previewable source files were found.</h2>
							<p>
								Add <code>{"src/**/*.tsx"}</code> files to one of the configured
								preview targets.
							</p>
						</div>
					</section>
				)}
			</section>
		</main>
	);
}
