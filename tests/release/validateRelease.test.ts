// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	PUBLIC_RELEASE_PACKAGES,
} from "../../scripts/release/release-config.mjs";
import {
	parseReleaseTag,
	validateReleaseVersions,
} from "../../scripts/release/validate-release.mjs";

function createReleasePackages(versionByName: Record<string, string>) {
	return PUBLIC_RELEASE_PACKAGES.map((releasePackage) => ({
		directory: releasePackage.directory,
		name: releasePackage.name,
		version: versionByName[releasePackage.name] ?? "0.1.0",
	}));
}

describe("validate-release script", () => {
	it("accepts a matching tag and monoversion release packages", () => {
		expect(() =>
			validateReleaseVersions("v0.1.0", createReleasePackages({})),
		).not.toThrow();
	});

	it("rejects a tag that does not match the package version", () => {
		expect(() =>
			validateReleaseVersions("v0.2.0", createReleasePackages({})),
		).toThrow(/does not match package version/u);
	});

	it("rejects release packages that do not share one version", () => {
		expect(() =>
			validateReleaseVersions(
				"v0.1.0",
				createReleasePackages({
					"@loom-dev/preview": "0.1.1",
				}),
			),
		).toThrow(/must share one version/u);
	});

	it("rejects non-release tag formats", () => {
		expect(() => parseReleaseTag("release-0.1.0")).toThrow(/must match vX.Y.Z/u);
	});
});
