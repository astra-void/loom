// pixelmatch v6 ships without bundled types; declare the (stable) signature.
declare module "pixelmatch" {
	interface PixelmatchOptions {
		/** Matching threshold, 0..1; smaller is more sensitive. Default 0.1. */
		threshold?: number;
		/** Whether to skip anti-aliasing detection. */
		includeAA?: boolean;
		/** Opacity of original image in the diff output, 0..1. */
		alpha?: number;
		/** Colour of anti-aliased pixels in the diff output. */
		aaColor?: [number, number, number];
		/** Colour of differing pixels in the diff output. */
		diffColor?: [number, number, number];
		/** Alternative colour for dark-on-light differences. */
		diffColorAlt?: [number, number, number];
		/** Draw the diff over a transparent background (a mask). */
		diffMask?: boolean;
	}

	/** Returns the number of mismatched pixels. */
	export default function pixelmatch(
		img1: Uint8Array | Uint8ClampedArray,
		img2: Uint8Array | Uint8ClampedArray,
		output: Uint8Array | Uint8ClampedArray | null,
		width: number,
		height: number,
		options?: PixelmatchOptions,
	): number;
}
