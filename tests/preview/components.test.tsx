// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	ensurePreviewGenerated,
	GENERATED_COMPONENT_TARGET,
} from "./ensureGenerated";

afterEach(() => {
	cleanup();
});

let generatedPreview: Awaited<ReturnType<typeof ensurePreviewGenerated>>;

beforeAll(async () => {
	generatedPreview = await ensurePreviewGenerated();
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
		GENERATED_COMPONENT_TARGET,
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
