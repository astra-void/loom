import { describe, expect, it } from "vitest";
import { analyzePreviewRuntimeError } from "../../packages/preview/src/execution/analyzeRuntimeError";

describe("analyzePreviewRuntimeError", () => {
	const entry = {
		id: "test-entry",
		targetName: "target",
		sourceFilePath: "/Users/dev/project/src/App.tsx",
		relativePath: "src/App.tsx",
		renderTarget: { kind: "none", reason: "no-component-export" },
		status: "ready",
		statusDetails: { kind: "ready", timestamp: 0 },
		candidateExportNames: [],
	} as const;

	const defaultContext = {
		entryId: entry.id,
		file: entry.sourceFilePath,
		relativeFile: entry.relativePath,
		target: entry.targetName,
	};

	it("classifies REACT_MAX_UPDATE_DEPTH", () => {
		const issue = analyzePreviewRuntimeError(
			entry,
			new Error(
				"Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.",
			),
			defaultContext,
		);
		expect(issue.code).toBe("REACT_MAX_UPDATE_DEPTH");
		expect(issue.summary).toContain("React render loop detected");
	});

	it("classifies REACT_TOO_MANY_RERENDERS", () => {
		const issue = analyzePreviewRuntimeError(
			entry,
			new Error(
				"Too many re-renders. React limits the number of renders to prevent an infinite loop.",
			),
			defaultContext,
		);
		expect(issue.code).toBe("REACT_TOO_MANY_RERENDERS");
		expect(issue.summary).toContain("React re-render loop detected");
	});

	it("classifies REACT_INVALID_HOOK_CALL", () => {
		const issue = analyzePreviewRuntimeError(
			entry,
			new Error(
				"Invalid hook call. Hooks can only be called inside of the body of a function component.",
			),
			defaultContext,
		);
		expect(issue.code).toBe("REACT_INVALID_HOOK_CALL");
		expect(issue.summary).toContain("Invalid hook call or hook order issue");
	});

	it("classifies PREVIEW_MISSING_GLOBAL", () => {
		const issue = analyzePreviewRuntimeError(
			entry,
			new ReferenceError("window is not defined"),
			defaultContext,
		);
		expect(issue.code).toBe("PREVIEW_MISSING_GLOBAL");
		expect(issue.summary).toContain(
			"Missing browser global accessed during preview",
		);
	});

	it("falls back to generic RENDER_ERROR", () => {
		const issue = analyzePreviewRuntimeError(
			entry,
			new Error("Something bad happened"),
			defaultContext,
		);
		expect(issue.code).toBe("RENDER_ERROR");
		expect(issue.summary).toBe("Something bad happened");
	});

	it("extracts project frame and uses it in summary and details", () => {
		const error = new Error("Maximum update depth exceeded");
		error.stack = `Error: Maximum update depth exceeded
    at scheduleUpdateOnFiber (node_modules/react-dom/cjs/react-dom.development.js:123:45)
    at Object.enqueueSetState (node_modules/react-dom/cjs/react-dom.development.js:456:78)
    at App (packages/preview-runtime/src/style/textStyles.ts:15:3)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:890:12)`;

		const issue = analyzePreviewRuntimeError(entry, error, defaultContext);
		expect(issue.code).toBe("REACT_MAX_UPDATE_DEPTH");
		expect(issue.summary).toContain(
			"packages/preview-runtime/src/style/textStyles.ts:15:3",
		);
		expect(issue.details).toContain(
			"packages/preview-runtime/src/style/textStyles.ts:15:3",
		);
		expect(issue.symbol).toBe(
			"App (packages/preview-runtime/src/style/textStyles.ts:15:3)",
		);
	});

	it("prefers entry frame over other project frames", () => {
		const error = new Error("Too many re-renders");
		error.stack = `Error: Too many re-renders
    at React Internal
    at OtherComponent (/Users/dev/project/src/Other.tsx:10:2)
    at App (/Users/dev/project/src/App.tsx:20:5)
    at Root`;

		const issue = analyzePreviewRuntimeError(entry, error, defaultContext);
		expect(issue.symbol).toBe("App (/Users/dev/project/src/App.tsx:20:5)");
	});

	it("preserves original stack and populates codeFrame with componentStack", () => {
		const error = new Error("Unknown error");
		error.stack = "Error: Unknown error\n  at something";
		const componentStack = "\n    at Component\n    at App";

		const issue = analyzePreviewRuntimeError(
			entry,
			{ error, componentStack },
			defaultContext,
		);
		expect(issue.stack).toContain(error.stack);
		expect(issue.codeFrame).toBe(componentStack);
		expect(issue.details).toContain(componentStack);
	});
});
