import { fireEvent } from "@testing-library/react";

function getEventTarget(target?: Element | null) {
	if (target instanceof HTMLElement) {
		return target;
	}

	if (document.activeElement instanceof HTMLElement) {
		return document.activeElement;
	}

	return document.body;
}

function isButtonLike(element: Element) {
	if (element instanceof HTMLButtonElement) {
		return true;
	}

	if (element instanceof HTMLInputElement) {
		return (
			element.type === "button" ||
			element.type === "submit" ||
			element.type === "reset"
		);
	}

	return element.getAttribute("role") === "button";
}

function setElementValue(element: HTMLElement, value: string) {
	const input = element as HTMLInputElement | HTMLTextAreaElement;
	const setter = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(input),
		"value",
	)?.set;

	setter?.call(input, value);
}

async function click(element: Element) {
	if (element instanceof HTMLElement) {
		element.focus();
	}

	fireEvent.click(element);
}

async function clear(element: HTMLElement) {
	setElementValue(element, "");
	fireEvent.input(element, { target: { value: "" } });
	fireEvent.change(element, { target: { value: "" } });
}

async function type(element: HTMLElement, text: string) {
	const currentValue = (element as HTMLInputElement | HTMLTextAreaElement)
		.value;
	const nextValue = `${currentValue}${text}`;

	setElementValue(element, nextValue);
	fireEvent.input(element, { target: { value: nextValue } });
	fireEvent.change(element, { target: { value: nextValue } });
}

async function keyboard(sequence: string) {
	const target = getEventTarget();
	if (sequence === "{Enter}") {
		fireEvent.keyDown(target, { code: "Enter", key: "Enter", charCode: 13 });
		fireEvent.keyPress(target, { code: "Enter", key: "Enter", charCode: 13 });
		fireEvent.keyUp(target, { code: "Enter", key: "Enter", charCode: 13 });

		if (isButtonLike(target)) {
			fireEvent.click(target);
		}

		return;
	}

	for (const character of sequence) {
		const charCode = character.charCodeAt(0);
		fireEvent.keyDown(target, { key: character, charCode });
		fireEvent.keyPress(target, { key: character, charCode });
		fireEvent.keyUp(target, { key: character, charCode });
	}
}

const user = {
	clear,
	click,
	keyboard,
	type,
};

export default {
	...user,
	setup() {
		return user;
	},
};
