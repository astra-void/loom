/**
 * Parity fixture scenes. Each scene exercises one or more of the Loom↔Roblox
 * divergences surfaced by the fidelity audit (list math, grid cell sizing,
 * automatic size, visual properties). They double as:
 *
 *  1. the harness self-test (render in Loom, assert capture works), and
 *  2. reference scenes to recreate in Roblox for a real 1:1 comparison.
 *
 * Scenes use the PascalCase host components imported from the runtime (the
 * in-process React path), NOT the lowercase JSX hosts (which require the Loom
 * compiler transform).
 */

import {
	Color3,
	Frame,
	ScreenGui,
	TextLabel,
	UDim,
	UDim2,
	UICorner,
	UIGridLayout,
	UIListLayout,
	UIPadding,
	UIStroke,
} from "@loom-dev/preview-runtime";
import type { ReactElement } from "react";
import type { ParityVec2 } from "../types";

export interface ParityScene {
	name: string;
	viewport: ParityVec2;
	element: ReactElement;
}

const VIEWPORT: ParityVec2 = { x: 800, y: 600 };

/** Vertical UIListLayout with padding — exercises list cursor + UIPadding math. */
function VerticalListScene(): ReactElement {
	return (
		<ScreenGui Name="VerticalListScene">
			<Frame
				Name="Panel"
				BackgroundColor3={Color3.fromRGB(30, 30, 35)}
				Position={UDim2.fromOffset(40, 40)}
				Size={UDim2.fromOffset(240, 300)}
			>
				<UIListLayout
					FillDirection="Vertical"
					Padding={new UDim(0, 8)}
					SortOrder="LayoutOrder"
				/>
				<UIPadding
					PaddingBottom={new UDim(0, 12)}
					PaddingLeft={new UDim(0, 12)}
					PaddingRight={new UDim(0, 12)}
					PaddingTop={new UDim(0, 12)}
				/>
				<Frame
					Name="RowA"
					BackgroundColor3={Color3.fromRGB(80, 120, 200)}
					LayoutOrder={1}
					Size={new UDim2(1, 0, 0, 40)}
				/>
				<Frame
					Name="RowB"
					BackgroundColor3={Color3.fromRGB(80, 200, 120)}
					LayoutOrder={2}
					Size={new UDim2(1, 0, 0, 40)}
				/>
				<Frame
					Name="RowC"
					BackgroundColor3={Color3.fromRGB(200, 120, 80)}
					LayoutOrder={3}
					Size={new UDim2(1, 0, 0, 40)}
				/>
			</Frame>
		</ScreenGui>
	);
}

/**
 * UIGridLayout where children declare their own Size (100x60) different from the
 * CellSize (80x80). Real Roblox forces each child to exactly CellSize; this is
 * audit finding #6 — a strong geometry divergence to detect.
 */
function GridCellsScene(): ReactElement {
	const cell = (
		name: string,
		order: number,
		color: [number, number, number],
	) => (
		<Frame
			key={name}
			Name={name}
			BackgroundColor3={Color3.fromRGB(color[0], color[1], color[2])}
			LayoutOrder={order}
			Size={UDim2.fromOffset(100, 60)}
		/>
	);
	return (
		<ScreenGui Name="GridCellsScene">
			<Frame
				Name="Grid"
				BackgroundColor3={Color3.fromRGB(24, 24, 28)}
				Position={UDim2.fromOffset(60, 60)}
				Size={UDim2.fromOffset(200, 200)}
			>
				<UIGridLayout
					CellPadding={UDim2.fromOffset(8, 8)}
					CellSize={UDim2.fromOffset(80, 80)}
					SortOrder="LayoutOrder"
				/>
				{cell("CellA", 1, [200, 80, 80])}
				{cell("CellB", 2, [80, 200, 80])}
				{cell("CellC", 3, [80, 80, 200])}
				{cell("CellD", 4, [200, 200, 80])}
			</Frame>
		</ScreenGui>
	);
}

/** Automatic-height container fed by a list — exercises AutomaticSize measurement. */
function AutoSizeScene(): ReactElement {
	return (
		<ScreenGui Name="AutoSizeScene">
			<Frame
				Name="Auto"
				AutomaticSize="Y"
				BackgroundColor3={Color3.fromRGB(20, 22, 28)}
				Position={UDim2.fromOffset(40, 40)}
				Size={new UDim2(0, 220, 0, 0)}
			>
				<UIListLayout
					FillDirection="Vertical"
					Padding={new UDim(0, 6)}
					SortOrder="LayoutOrder"
				/>
				<Frame Name="A" LayoutOrder={1} Size={UDim2.fromOffset(220, 50)} />
				<Frame Name="B" LayoutOrder={2} Size={UDim2.fromOffset(220, 50)} />
			</Frame>
		</ScreenGui>
	);
}

/** Styled card — exercises visual-property capture (colours, text, corner, stroke). */
function StyledCardScene(): ReactElement {
	return (
		<ScreenGui Name="StyledCardScene">
			<Frame
				Name="Card"
				BackgroundColor3={Color3.fromRGB(40, 44, 52)}
				BackgroundTransparency={0}
				Position={UDim2.fromOffset(80, 80)}
				Size={UDim2.fromOffset(240, 120)}
			>
				<UICorner CornerRadius={new UDim(0, 12)} />
				<UIStroke Color={Color3.fromRGB(120, 140, 200)} Thickness={2} />
				<TextLabel
					Name="Title"
					BackgroundTransparency={1}
					Position={UDim2.fromOffset(16, 16)}
					Size={UDim2.fromOffset(208, 28)}
					Text="Parity Card"
					TextColor3={Color3.fromRGB(235, 238, 245)}
					TextSize={18}
				/>
			</Frame>
		</ScreenGui>
	);
}

export const parityScenes: ParityScene[] = [
	{ name: "vertical-list", viewport: VIEWPORT, element: <VerticalListScene /> },
	{ name: "grid-cells", viewport: VIEWPORT, element: <GridCellsScene /> },
	{ name: "auto-size", viewport: VIEWPORT, element: <AutoSizeScene /> },
	{ name: "styled-card", viewport: VIEWPORT, element: <StyledCardScene /> },
];

export function getParityScene(name: string): ParityScene | undefined {
	return parityScenes.find((scene) => scene.name === name);
}
