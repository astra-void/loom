// Vite's `?raw` imports: the Luau script arrives as its source text.
declare module "*.luau?raw" {
	const source: string;
	export default source;
}
