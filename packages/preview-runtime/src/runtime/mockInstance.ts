export interface MockInstanceLike {
	ClassName?: string;
	IsA?(name: string): boolean;
	Parent: MockInstanceLike | undefined;
}

export function getMockParent(value: unknown): MockInstanceLike | undefined {
	if (value === null || typeof value !== "object") {
		return undefined;
	}

	const parent = (value as MockInstanceLike).Parent;
	return parent === null ? undefined : parent;
}

export function findMockAncestor(
	value: unknown,
	predicate: (ancestor: MockInstanceLike) => boolean,
): MockInstanceLike | undefined {
	let current = getMockParent(value);
	while (current !== undefined) {
		if (typeof current !== "object") {
			break;
		}

		if (predicate(current as MockInstanceLike)) {
			return current as MockInstanceLike;
		}

		current = getMockParent(current);
	}

	return undefined;
}

export function findMockAncestorWhichIsA(
	value: unknown,
	className: string,
): MockInstanceLike | undefined {
	return findMockAncestor(value, (ancestor) => {
		if (typeof ancestor.IsA === "function") {
			return ancestor.IsA(className);
		}

		return ancestor.ClassName === className;
	});
}

export function findMockAncestorOfClass(
	value: unknown,
	className: string,
): MockInstanceLike | undefined {
	return findMockAncestor(
		value,
		(ancestor) => ancestor.ClassName === className,
	);
}
