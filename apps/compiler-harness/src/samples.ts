export type CompilerSample = {
	description: string;
	id: string;
	label: string;
	source: string;
};

export const compilerSamples: CompilerSample[] = [
	{
		description: "Compiles clean TSX into Roblox host calls.",
		id: "renderable",
		label: "Renderable",
		source: `export const App = () => (
  <textlabel Text="Compiler wasm" TextSize={24} />
);`,
	},
	{
		description: "Shows the error state for malformed JSX.",
		id: "broken",
		label: "Broken",
		source: `export const App = () => (
  <textlabel Text="Missing closing tag"
);`,
	},
];
