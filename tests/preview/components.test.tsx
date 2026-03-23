// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ hookTimeout: 20000, testTimeout: 20000 });

afterEach(() => {
	cleanup();
});

let generatedPreview: Awaited<
	ReturnType<typeof import("./ensureGenerated").ensurePreviewGenerated>
>;
let generatedComponentTarget = "";

beforeAll(async () => {
	globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
	globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
	globalThis.Uint8Array = new globalThis.TextEncoder().encode("")
		.constructor as typeof globalThis.Uint8Array;

	const ensureGeneratedModule = await import("./ensureGenerated");
	generatedComponentTarget = ensureGeneratedModule.GENERATED_COMPONENT_TARGET;
	generatedPreview = await ensureGeneratedModule.ensurePreviewGenerated();
});

function toRelativeSpecifier(filePath: string) {
	const relativePath = path
		.relative(__dirname, filePath)
		.split(path.sep)
		.join("/");
	return relativePath.startsWith("./") || relativePath.startsWith("../")
		? relativePath
		: `./${relativePath}`;
}

function findGeneratedFile(relativePath: string) {
	const generatedFilePath = path.join(
		generatedPreview.outDir,
		generatedComponentTarget,
		relativePath,
	);
	if (!fs.existsSync(generatedFilePath)) {
		throw new Error(`Missing generated preview file for ${relativePath}.`);
	}

	return generatedFilePath;
}

describe("generated preview components", () => {
	it("renders generated source components from the fixture package", async () => {
		const { CheckboxRoot } = await import(
			/* @vite-ignore */ toRelativeSpecifier(
				findGeneratedFile("CheckboxRoot.tsx"),
			)
		);

		render(<CheckboxRoot />);

		expect(screen.getByRole("button", { name: /checkbox/i })).toBeTruthy();
	});

	it("renders generated preview contracts from the fixture package", async () => {
		const dialogModule = await import(
			/* @vite-ignore */ toRelativeSpecifier(
				findGeneratedFile("DialogRoot.tsx"),
			)
		);

		expect(typeof dialogModule.preview?.render).toBe("function");

		render(dialogModule.preview.render());

		expect(screen.getByText("Harnessed Dialog")).toBeTruthy();
	});
});
