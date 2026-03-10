import * as React from "react";

type FontStyleDescriptor = Pick<React.CSSProperties, "fontFamily" | "fontStyle" | "fontWeight">;

type TextScaleOptions = {
  elementRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  fontFamily?: string;
  fontStyle?: React.CSSProperties["fontStyle"];
  fontWeight?: React.CSSProperties["fontWeight"];
  lineHeight?: React.CSSProperties["lineHeight"];
  text: string | undefined;
  wrapped?: boolean;
};

type ElementSize = {
  height: number;
  width: number;
};

const DEFAULT_FONT_FAMILY = '"Gotham", "Montserrat", "Avenir Next", sans-serif';
const DEFAULT_MONO_FONT_FAMILY = '"IBM Plex Mono", "SFMono-Regular", monospace';
const DEFAULT_SOURCE_SANS_FAMILY = '"Source Sans 3", "Source Sans Pro", "Segoe UI", sans-serif';
const DEFAULT_LINE_HEIGHT = 1.2;

const FONT_MAPPINGS: Record<string, FontStyleDescriptor> = {
  code: {
    fontFamily: DEFAULT_MONO_FONT_FAMILY,
  },
  gotham: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: 400,
  },
  gothamblack: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: 800,
  },
  gothambold: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: 700,
  },
  gothammedium: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: 500,
  },
  gothamsemibold: {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: 600,
  },
  robotomono: {
    fontFamily: DEFAULT_MONO_FONT_FAMILY,
  },
  sourcesans: {
    fontFamily: DEFAULT_SOURCE_SANS_FAMILY,
    fontWeight: 400,
  },
  sourcesansbold: {
    fontFamily: DEFAULT_SOURCE_SANS_FAMILY,
    fontWeight: 700,
  },
  sourcesansitalic: {
    fontFamily: DEFAULT_SOURCE_SANS_FAMILY,
    fontStyle: "italic",
    fontWeight: 400,
  },
  sourcesanslight: {
    fontFamily: DEFAULT_SOURCE_SANS_FAMILY,
    fontWeight: 300,
  },
  sourcesanssemibold: {
    fontFamily: DEFAULT_SOURCE_SANS_FAMILY,
    fontWeight: 600,
  },
  ubuntu: {
    fontFamily: '"Ubuntu", "Trebuchet MS", sans-serif',
  },
};

function extractFontName(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (value.startsWith("Enum.Font.")) {
      return value.slice("Enum.Font.".length);
    }

    return value.split(".").pop()?.trim() || undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as { Name?: unknown };
  if (typeof record.Name === "string" && record.Name.length > 0) {
    return record.Name;
  }

  const stringValue = String(value);
  if (stringValue.startsWith("Enum.Font.")) {
    return stringValue.slice("Enum.Font.".length);
  }

  return undefined;
}

function normalizeSize(value: DOMRectReadOnly | ClientRect | undefined | null): ElementSize {
  return {
    height: Math.max(0, value?.height ?? 0),
    width: Math.max(0, value?.width ?? 0),
  };
}

function areElementSizesEqual(left: ElementSize | null, right: ElementSize | null) {
  return left?.width === right?.width && left?.height === right?.height;
}

function useObservedElementSize(elementRef: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = React.useState<ElementSize | null>(null);

  React.useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const update = (nextRect?: DOMRectReadOnly | ClientRect | null) => {
      const nextSize = normalizeSize(nextRect ?? element.getBoundingClientRect());
      setSize((previous) => (areElementSizesEqual(previous, nextSize) ? previous : nextSize));
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === element) ?? entries[0];
        update(entry?.contentRect);
      });
      observer.observe(element);

      return () => {
        observer.disconnect();
      };
    }

    const handleResize = () => {
      update();
    };

    globalThis.addEventListener?.("resize", handleResize);
    return () => {
      globalThis.removeEventListener?.("resize", handleResize);
    };
  }, [elementRef]);

  return size;
}

function toNumericLineHeight(value: React.CSSProperties["lineHeight"]) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return DEFAULT_LINE_HEIGHT;
}

function measureScaledFontSize(options: TextScaleOptions & { size: ElementSize }) {
  if (typeof document === "undefined") {
    return null;
  }

  const measurement = document.createElement("div");
  measurement.style.position = "fixed";
  measurement.style.left = "-100000px";
  measurement.style.top = "0";
  measurement.style.pointerEvents = "none";
  measurement.style.visibility = "hidden";
  measurement.style.margin = "0";
  measurement.style.padding = "0";
  measurement.style.boxSizing = "border-box";
  measurement.style.fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  measurement.style.fontStyle = options.fontStyle ?? "normal";
  measurement.style.fontWeight = options.fontWeight === undefined ? "400" : String(options.fontWeight);
  measurement.style.lineHeight = String(toNumericLineHeight(options.lineHeight));
  measurement.style.whiteSpace = options.wrapped ? "pre-wrap" : "pre";
  measurement.style.overflowWrap = options.wrapped ? "break-word" : "normal";
  measurement.style.wordBreak = options.wrapped ? "break-word" : "normal";
  measurement.style.width = options.wrapped ? `${options.size.width}px` : "max-content";
  measurement.textContent = options.text && options.text.length > 0 ? options.text : " ";
  document.body.appendChild(measurement);

  const fits = (fontSize: number) => {
    measurement.style.fontSize = `${fontSize}px`;
    return measurement.scrollWidth <= options.size.width + 0.5 && measurement.scrollHeight <= options.size.height + 0.5;
  };

  let lowerBound = 1;
  let upperBound = Math.max(1, Math.ceil(Math.max(options.size.width, options.size.height)));

  while (lowerBound < upperBound) {
    const midpoint = Math.ceil((lowerBound + upperBound + 1) / 2);
    if (fits(midpoint)) {
      lowerBound = midpoint;
    } else {
      upperBound = midpoint - 1;
    }
  }

  measurement.remove();
  return lowerBound;
}

export function mapRobloxFont(value: unknown): FontStyleDescriptor {
  const fontName = extractFontName(value)?.toLowerCase();
  if (!fontName) {
    return {};
  }

  return (
    FONT_MAPPINGS[fontName] ?? {
      fontFamily: DEFAULT_FONT_FAMILY,
    }
  );
}

export function useTextScaleStyle(options: TextScaleOptions): React.CSSProperties | undefined {
  const size = useObservedElementSize(options.elementRef);
  const [fontSize, setFontSize] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    if (!options.enabled || !size || size.width <= 0 || size.height <= 0) {
      setFontSize(null);
      return;
    }

    setFontSize(
      measureScaledFontSize({
        ...options,
        size,
      }),
    );
  }, [
    options.elementRef,
    options.enabled,
    options.fontFamily,
    options.fontStyle,
    options.fontWeight,
    options.lineHeight,
    options.text,
    options.wrapped,
    size,
  ]);

  if (!options.enabled || fontSize === null) {
    return undefined;
  }

  return {
    fontSize: `${fontSize}px`,
    lineHeight: options.lineHeight ?? DEFAULT_LINE_HEIGHT,
  };
}
