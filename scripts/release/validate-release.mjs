import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	PUBLIC_RELEASE_PACKAGES,
	RELEASE_TAG_PATTERN,
} from "./release-config.mjs";

export function parseReleaseTagParts(tagName) {
	const match = RELEASE_TAG_PATTERN.exec(tagName);

	if (!match?.groups?.version) {
		throw new Error(
			`Release tag must match vX.Y.Z or vX.Y.Z-prerelease. Received ${JSON.stringify(tagName)}.`,
		);
	}

	const prerelease = match.groups.prerelease;

	return {
		distTag: prerelease?.split(".")[0] ?? null,
		prerelease: prerelease ?? null,
		version: match.groups.version + (prerelease ? `-${prerelease}` : ""),
	};
}

export function parseReleaseTag(tagName) {
	return parseReleaseTagParts(tagName).version;
}

export function getReleaseDistTag(tagName) {
	return parseReleaseTagParts(tagName).distTag;
}

export function readReleasePackageManifests(workspaceRoot = process.cwd()) {
	return PUBLIC_RELEASE_PACKAGES.map((releasePackage) => {
		const manifestPath = resolve(
			workspaceRoot,
			releasePackage.directory,
			"package.json",
		);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

		return {
			directory: releasePackage.directory,
			manifestPath,
			name: manifest.name,
			version: manifest.version,
		};
	});
}

export function validateReleaseVersions(tagName, releasePackages) {
	const expectedVersion = parseReleaseTag(tagName);
	const discoveredVersions = new Set();

	for (const releasePackage of releasePackages) {
		if (releasePackage.name == null || releasePackage.name.length === 0) {
			throw new Error(
				`Release package at ${releasePackage.directory} is missing a name.`,
			);
		}

		if (releasePackage.version == null || releasePackage.version.length === 0) {
			throw new Error(
				`Release package ${releasePackage.name} is missing a version.`,
			);
		}

		discoveredVersions.add(releasePackage.version);
	}

	if (discoveredVersions.size !== 1) {
		throw new Error(
			`Release packages must share one version. Found ${[...discoveredVersions]
				.sort()
				.join(", ")}.`,
		);
	}

	const [workspaceVersion] = discoveredVersions;

	if (workspaceVersion !== expectedVersion) {
		throw new Error(
			`Release tag ${tagName} does not match package version ${workspaceVersion}.`,
		);
	}
}

export function ensureCommitIsOnMain(
	execFileSyncImpl = execFileSync,
	workspaceRoot = process.cwd(),
) {
	const output = execFileSyncImpl(
		"git",
		["branch", "--remotes", "--contains", "HEAD"],
		{
			cwd: workspaceRoot,
			encoding: "utf8",
			stdio: ["inherit", "pipe", "inherit"],
		},
	);

	const remoteBranches = output
		.split("\n")
		.map((line) => line.replace(/^[*\s]+/u, "").trim())
		.filter(Boolean);

	if (!remoteBranches.includes("origin/main")) {
		throw new Error(
			"Release tag must point to a commit contained in origin/main.",
		);
	}
}

function main() {
	const tagName =
		process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? process.argv[2];

	if (!tagName) {
		throw new Error(
			"Release tag name is required via GITHUB_REF_NAME or the first CLI argument.",
		);
	}

	const releasePackages = readReleasePackageManifests();
	validateReleaseVersions(tagName, releasePackages);
	ensureCommitIsOnMain();

	process.stdout.write(
		`Validated release tag ${tagName} for ${releasePackages.length} packages.\n`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
