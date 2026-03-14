function escapeRegExp(value: string) {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function normalizeGlobInput(value: string) {
	return value.replace(/\\/g, "/");
}

export function createGlobMatcher(pattern: string) {
	const normalizedPattern = normalizeGlobInput(pattern);
	let source = "^";

	for (let index = 0; index < normalizedPattern.length; index += 1) {
		const character = normalizedPattern[index];
		const nextCharacter = normalizedPattern[index + 1];
		const characterAfterNext = normalizedPattern[index + 2];
		const previousCharacter =
			index > 0 ? normalizedPattern[index - 1] : undefined;

		if (character === "*" && nextCharacter === "*") {
			if (
				characterAfterNext === "/" &&
				(previousCharacter === undefined || previousCharacter === "/")
			) {
				source += "(?:[^/]+/)*";
				index += 2;
				continue;
			}

			source += ".*";
			index += 1;
			continue;
		}

		if (character === "*") {
			source += "[^/]*";
			continue;
		}

		source += escapeRegExp(character);
	}

	source += "$";
	return new RegExp(source);
}

export function matchesGlobPatterns(
	value: string,
	patterns: string[] | undefined,
) {
	if (!patterns || patterns.length === 0) {
		return false;
	}

	const normalizedValue = normalizeGlobInput(value);
	return patterns.some((pattern) =>
		createGlobMatcher(pattern).test(normalizedValue),
	);
}
