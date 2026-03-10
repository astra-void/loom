declare const Color3: {
  fromRGB(r: number, g: number, b: number): unknown;
};

declare const Enum: any;

declare const UDim: {
  new (scale: number, offset: number): unknown;
};

declare const UDim2: {
  new (
    xScale: number,
    xOffset: number,
    yScale: number,
    yOffset: number,
  ): {
    X: unknown;
    Y: unknown;
    add(other: unknown): unknown;
    sub(other: unknown): unknown;
  };
  fromOffset(x: number, y: number): unknown;
  fromScale(x: number, y: number): unknown;
};

declare const game: any;

interface PreviewIntrinsicElements {
  frame: Record<string, unknown>;
  imagelabel: Record<string, unknown>;
  scrollingframe: Record<string, unknown>;
  textbutton: Record<string, unknown>;
  textlabel: Record<string, unknown>;
  uicorner: Record<string, unknown>;
  uilistlayout: Record<string, unknown>;
  uipadding: Record<string, unknown>;
  uistroke: Record<string, unknown>;
}

declare namespace JSX {
  interface IntrinsicElements extends PreviewIntrinsicElements {}
}

declare namespace React {
  namespace JSX {
    interface IntrinsicElements extends PreviewIntrinsicElements {}
  }
}
