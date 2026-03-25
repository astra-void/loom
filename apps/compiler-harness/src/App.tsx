import { compile_tsx } from "@loom-dev/compiler/wasm";
import React from "react";
import { type CompilerSample, compilerSamples } from "./samples";

type CompilationResult = {
	code: string;
	error: string | null;
	status: string;
};

function toErrorMessage(error: unknown) {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function compileSource(source: string): CompilationResult {
	try {
		return {
			code: compile_tsx(source),
			error: null,
			status: "Ready",
		};
	} catch (error) {
		return {
			code: "",
			error: toErrorMessage(error),
			status: "Compilation failed",
		};
	}
}

function getLineCount(code: string) {
	if (!code) {
		return 0;
	}

	return code.split(/\r?\n/).length;
}

export function App() {
	const [source, setSource] = React.useState(compilerSamples[0].source);
	const [activeSample, setActiveSample] = React.useState<CompilerSample>(
		compilerSamples[0],
	);

	const compilation = compileSource(source);

	return (
		<main className="compiler-shell">
			<div className="compiler-shell-glow compiler-shell-glow-left" />
			<div className="compiler-shell-glow compiler-shell-glow-right" />

			<header className="compiler-header">
				<div className="compiler-header-copy">
					<p className="eyebrow">Compiler wasm harness</p>
					<h1>@loom-dev/compiler/wasm</h1>
					<p className="subtitle">
						Browser-side smoke test for TSX compilation. Edit the source on the
						left and inspect the emitted JS on the right.
					</p>
				</div>

				<div className="compiler-metrics">
					<div className="metric-card">
						<span className="metric-label">Status</span>
						<strong
							className={`metric-value ${compilation.error ? "danger" : ""}`}
						>
							{compilation.status}
						</strong>
					</div>
					<div className="metric-card">
						<span className="metric-label">Sample</span>
						<strong className="metric-value">{activeSample.label}</strong>
					</div>
					<div className="metric-card">
						<span className="metric-label">Lines</span>
						<strong className="metric-value">
							{getLineCount(compilation.code)}
						</strong>
					</div>
				</div>
			</header>

			<section className="sample-strip" aria-label="Compiler samples">
				{compilerSamples.map((sample) => {
					const isActive = sample.id === activeSample.id;

					return (
						<button
							key={sample.id}
							className={`sample-chip ${isActive ? "active" : ""}`}
							onClick={() => {
								setActiveSample(sample);
								setSource(sample.source);
							}}
							type="button"
						>
							<span>{sample.label}</span>
							<small>{sample.description}</small>
						</button>
					);
				})}
			</section>

			<section className="compiler-grid">
				<article className="panel editor-panel">
					<div className="panel-header">
						<div>
							<p className="panel-kicker">Input</p>
							<h2>TSX source</h2>
						</div>
						<span className="panel-badge">Editable</span>
					</div>
					<textarea
						aria-label="Compiler input"
						className="code-editor"
						onChange={(event) => {
							setSource(event.target.value);
							setActiveSample({
								...activeSample,
								id: "custom",
								label: "Custom",
								description: "Hand-edited source",
							});
						}}
						spellCheck={false}
						value={source}
					/>
				</article>

				<article className="panel output-panel">
					<div className="panel-header">
						<div>
							<p className="panel-kicker">Output</p>
							<h2>Emitted JS</h2>
						</div>
						<span
							className={`panel-badge ${compilation.error ? "danger" : ""}`}
						>
							{compilation.error ? "Error" : "Wasm"}
						</span>
					</div>

					{compilation.error ? (
						<div className="error-shell">
							<p className="error-title">Compilation failed</p>
							<pre className="error-copy">{compilation.error}</pre>
						</div>
					) : (
						<pre className="code-output">{compilation.code}</pre>
					)}
				</article>
			</section>
		</main>
	);
}
