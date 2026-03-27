function normalizeText(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

export function findFirstDescendant(
	root: ParentNode,
	predicate: (instance: Element) => boolean,
) {
	if (root instanceof Element && predicate(root)) {
		return root;
	}

	for (const element of root.querySelectorAll("*")) {
		if (element instanceof Element && predicate(element)) {
			return element;
		}
	}

	return undefined;
}

export function findGuiObjectByName(root: ParentNode, name: string) {
	return findFirstDescendant(
		root,
		(instance) =>
			instance.getAttribute("data-preview-node-id") === name ||
			instance.getAttribute("data-preview-test-container") === name ||
			instance.id === name,
	);
}

function findPreviewTextElement(
	root: ParentNode,
	host: "textbutton" | "textlabel",
	text: string,
) {
	const normalizedText = normalizeText(text);
	return findFirstDescendant(root, (instance) => {
		if (instance.getAttribute("data-preview-host") !== host) {
			return false;
		}

		return normalizeText(instance.textContent ?? "") === normalizedText;
	});
}

export function findTextButtonByText(root: ParentNode, text: string) {
	return findPreviewTextElement(root, "textbutton", text);
}

export function findTextLabelByText(root: ParentNode, text: string) {
	return findPreviewTextElement(root, "textlabel", text);
}
