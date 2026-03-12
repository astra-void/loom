declare module "jsdom" {
	export class JSDOM {
		public constructor(
			html?: string,
			options?: {
				pretendToBeVisual?: boolean;
				url?: string;
			},
		);

		public readonly window: Window & typeof globalThis;
	}
}
