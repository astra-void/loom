// @vitest-environment jsdom

import {
	Frame,
	getPreviewLayoutProbeSnapshot,
	LayoutProvider,
	Presence,
	ScreenGui,
	Slot,
	Text,
	TextLabel,
	UDim2,
} from "@loom-dev/preview-runtime";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, expect, test } from "vitest";

type DebugNode = {
	children?: DebugNode[];
	id?: string;
	layoutSource?: string;
	parentId?: string;
	rect?: {
		height: number;
		width: number;
		x: number;
		y: number;
	};
};

function findDebugNode(nodes: DebugNode[], targetId: string): DebugNode | null {
	for (const node of nodes) {
		if (node.id === targetId) {
			return node;
		}

		const found = findDebugNode(node.children ?? [], targetId);
		if (found) {
			return found;
		}
	}

	return null;
}

function getDebugNodeById(targetId: string): DebugNode | null {
	const roots = getPreviewLayoutProbeSnapshot().debug.roots as DebugNode[];
	return findDebugNode(roots, targetId);
}

type AccordionContentProps = React.ComponentPropsWithoutRef<typeof Frame> & {
	asChild?: boolean;
	forceMount?: boolean;
	open?: boolean;
};

const AccordionContent = React.forwardRef<HTMLElement, AccordionContentProps>(
	({ asChild = false, children, forceMount = false, open = true, ...props }, ref) => {
		const Component = asChild ? Slot : Frame;
		const visible = open && props.Visible !== false;
		const content = (
			<Component ref={ref} {...props} Visible={visible}>
				{children}
			</Component>
		);

		if (forceMount) {
			return content;
		}

		return <Presence present={open} render={() => content} />;
	},
);

AccordionContent.displayName = "TestAccordionContent";

afterEach(() => {
	cleanup();
});

test("preserves slot child Position and Size through Text host registration", async () => {
	render(
		<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
			<ScreenGui Id="screen">
				<Frame Id="item" Size={UDim2.fromOffset(200, 80)}>
					<Slot>
						<Text
							Id="content"
							Position={UDim2.fromOffset(10, 40)}
							Size={UDim2.fromOffset(120, 24)}
							Text="Accordion Content"
						/>
					</Slot>
				</Frame>
			</ScreenGui>
		</LayoutProvider>,
	);

	await waitFor(() => {
		const contentNode = getDebugNodeById("content");
		expect(contentNode).toBeTruthy();
		expect(contentNode?.parentId).toBe("item");
		expect(contentNode?.layoutSource).toBe("explicit-size");
		expect(contentNode?.rect).toMatchObject({
			height: 24,
			width: 120,
			x: 10,
			y: 40,
		});
	});
});

test("accordion-style content asChild preserves TextLabel and Frame host placement", async () => {
	render(
		<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
			<ScreenGui Id="screen">
				<Frame Id="accordion-item" Size={UDim2.fromOffset(220, 80)}>
					<Frame Id="accordion-trigger" Size={UDim2.fromOffset(220, 32)} />
					<AccordionContent
						Id="accordion-content-slot"
						forceMount
						open
						Position={UDim2.fromOffset(10, 40)}
						Size={UDim2.fromOffset(120, 24)}
						asChild
					>
						<TextLabel Id="accordion-body" Text="Accordion body" />
					</AccordionContent>
				</Frame>

				<Frame
					Id="wrapped-accordion-item"
					Position={UDim2.fromOffset(0, 100)}
					Size={UDim2.fromOffset(220, 80)}
				>
					<Frame
						Id="wrapped-accordion-trigger"
						Size={UDim2.fromOffset(220, 32)}
					/>
					<AccordionContent
						Id="wrapped-accordion-content-slot"
						forceMount
						open
						Position={UDim2.fromOffset(10, 40)}
						Size={UDim2.fromOffset(140, 28)}
						asChild
					>
						<Frame Id="wrapped-accordion-body">
							<TextLabel
								Id="wrapped-accordion-body-text"
								Size={UDim2.fromOffset(140, 28)}
								Text="Wrapped body"
							/>
						</Frame>
					</AccordionContent>
				</Frame>
			</ScreenGui>
		</LayoutProvider>,
	);

	await waitFor(() => {
		const bodyElement = document.querySelector(
			'[data-preview-host="textlabel"][data-preview-node-id="accordion-body"]',
		);
		const bodyNode = getDebugNodeById("accordion-body");
		const slotNode = getDebugNodeById("accordion-content-slot");

		expect(bodyElement).toBeTruthy();
		expect(bodyNode).toBeTruthy();
		expect(slotNode).toBeNull();
		expect(bodyNode?.parentId).toBe("accordion-item");
		expect(bodyNode?.rect).toMatchObject({
			height: 24,
			width: 120,
			x: 10,
			y: 40,
		});
	});

	await waitFor(() => {
		const wrapperElement = document.querySelector(
			'[data-preview-host="frame"][data-preview-node-id="wrapped-accordion-body"]',
		);
		const textElement = document.querySelector(
			'[data-preview-host="textlabel"][data-preview-node-id="wrapped-accordion-body-text"]',
		);
		const wrapperNode = getDebugNodeById("wrapped-accordion-body");
		const textNode = getDebugNodeById("wrapped-accordion-body-text");
		const slotNode = getDebugNodeById("wrapped-accordion-content-slot");

		expect(wrapperElement).toBeTruthy();
		expect(textElement).toBeTruthy();
		expect(wrapperNode).toBeTruthy();
		expect(textNode).toBeTruthy();
		expect(slotNode).toBeNull();
		expect(wrapperNode?.parentId).toBe("wrapped-accordion-item");
		expect(textNode?.parentId).toBe("wrapped-accordion-body");
		expect(wrapperNode?.rect).toMatchObject({
			height: 28,
			width: 140,
			x: 10,
			y: 140,
		});
		expect(textNode?.rect).toMatchObject({
			height: 28,
			width: 140,
			x: 10,
			y: 140,
		});
	});
});

test("Text asChild preserves child TextLabel identity through Slot", async () => {
	render(
		<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
			<ScreenGui Id="screen">
				<Frame Id="item" Size={UDim2.fromOffset(220, 80)}>
					<Text
						Id="text-slot"
						Position={UDim2.fromOffset(10, 40)}
						Size={UDim2.fromOffset(120, 24)}
						asChild
					>
						<TextLabel Id="text-as-child-body" Text="Text as child" />
					</Text>
				</Frame>
			</ScreenGui>
		</LayoutProvider>,
	);

	await waitFor(() => {
		const bodyElement = document.querySelector(
			'[data-preview-host="textlabel"][data-preview-node-id="text-as-child-body"]',
		);
		const bodyNode = getDebugNodeById("text-as-child-body");
		const slotNode = getDebugNodeById("text-slot");

		expect(bodyElement).toBeTruthy();
		expect(bodyNode).toBeTruthy();
		expect(slotNode).toBeNull();
		expect(bodyNode?.parentId).toBe("item");
		expect(bodyNode?.rect).toMatchObject({
			height: 24,
			width: 120,
			x: 10,
			y: 40,
		});
	});
});

test("does not let slot-hidden content inflate automatic parent height", async () => {
	render(
		<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
			<ScreenGui Id="screen">
				<Frame AutomaticSize="Y" Id="item" Size={UDim2.fromOffset(200, 0)}>
					<Frame Id="header" Size={UDim2.fromOffset(200, 32)} />
					<Slot Visible={false}>
						<Text
							Id="content"
							Position={UDim2.fromOffset(10, 40)}
							Size={UDim2.fromOffset(120, 24)}
							Text="Hidden Content"
						/>
					</Slot>
				</Frame>
			</ScreenGui>
		</LayoutProvider>,
	);

	await waitFor(() => {
		const itemNode = getDebugNodeById("item");
		expect(itemNode).toBeTruthy();
		expect(itemNode?.rect?.height).toBe(32);
	});

	await waitFor(() => {
		expect(getDebugNodeById("content")).toBeNull();
	});
});

test("fixed-height accordion rows stay expanded for both text and frame content", async () => {
	render(
		<LayoutProvider debounceMs={0} viewportHeight={240} viewportWidth={320}>
			<ScreenGui Id="screen">
				<Frame Id="item-text" Size={UDim2.fromOffset(200, 74)}>
					<Frame Id="header-text" Size={UDim2.fromOffset(200, 32)} />
					<Slot Visible={false}>
						<Text
							Id="content-text"
							Position={UDim2.fromOffset(10, 40)}
							Size={UDim2.fromOffset(120, 24)}
							Text="Text child"
						/>
					</Slot>
				</Frame>

				<Frame
					Id="item-frame"
					Position={UDim2.fromOffset(0, 90)}
					Size={UDim2.fromOffset(200, 74)}
				>
					<Frame Id="header-frame" Size={UDim2.fromOffset(200, 32)} />
					<Slot Visible={false}>
						<Frame
							Id="content-frame-wrapper"
							Position={UDim2.fromOffset(10, 40)}
							Size={UDim2.fromOffset(120, 24)}
						>
							<Text
								Id="content-frame-text"
								Size={UDim2.fromOffset(120, 24)}
								Text="Framed child"
							/>
						</Frame>
					</Slot>
				</Frame>
			</ScreenGui>
		</LayoutProvider>,
	);

	await waitFor(() => {
		expect(getDebugNodeById("item-text")?.rect?.height).toBe(74);
		expect(getDebugNodeById("item-frame")?.rect?.height).toBe(74);
	});
});
