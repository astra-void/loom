// @vitest-environment jsdom

import {
	Frame,
	getPreviewLayoutProbeSnapshot,
	LayoutProvider,
	ScreenGui,
	Slot,
	Text,
	UDim2,
} from "@loom-dev/preview-runtime";
import { cleanup, render, waitFor } from "@testing-library/react";
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
