import type { UDim2Value, Vector2 } from "../runtime/helpers";

export type UDimLike = { Scale?: number; Offset?: number; scale?: number; offset?: number } | readonly [number, number];

export type UDim2Like =
  | UDim2Value
  | { X?: UDimLike; Y?: UDimLike; x?: UDimLike; y?: UDimLike }
  | readonly [number, number, number, number]
  | readonly [UDimLike, UDimLike];

export type Vector2Like = Vector2 | { X?: number; Y?: number; x?: number; y?: number } | readonly [number, number];

export type SerializedUDim = {
  Scale: number;
  Offset: number;
};

export type SerializedUDim2 = {
  X: SerializedUDim;
  Y: SerializedUDim;
};

export type SerializedVector2 = {
  X: number;
  Y: number;
};

export const ZERO_UDIM: SerializedUDim = {
  Offset: 0,
  Scale: 0,
};

export const ZERO_UDIM2: SerializedUDim2 = {
  X: ZERO_UDIM,
  Y: ZERO_UDIM,
};

export const FULL_SIZE_UDIM2: SerializedUDim2 = {
  X: {
    Offset: 0,
    Scale: 1,
  },
  Y: {
    Offset: 0,
    Scale: 1,
  },
};

export const ZERO_VECTOR2: SerializedVector2 = {
  X: 0,
  Y: 0,
};

const PREVIEW_NODE_ID_PATTERN = /(?:^|:)(preview-node-\d+)$/;

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePreviewNodeId(nodeId: string | undefined): string | undefined {
  if (!nodeId) {
    return undefined;
  }

  const match = PREVIEW_NODE_ID_PATTERN.exec(nodeId);
  return match?.[1] ?? nodeId;
}

export function serializeUDim(value: unknown, fallback: SerializedUDim = ZERO_UDIM): SerializedUDim {
  if (Array.isArray(value)) {
    return {
      Offset: toFiniteNumber(value[1], fallback.Offset),
      Scale: toFiniteNumber(value[0], fallback.Scale),
    };
  }

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as { Offset?: number; Scale?: number; offset?: number; scale?: number };
  return {
    Offset: toFiniteNumber(record.Offset ?? record.offset, fallback.Offset),
    Scale: toFiniteNumber(record.Scale ?? record.scale, fallback.Scale),
  };
}

export function serializeUDim2(value: unknown, fallback?: SerializedUDim2): SerializedUDim2 | undefined {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (Array.isArray(value)) {
    if (value.length >= 4) {
      return {
        X: serializeUDim([value[0], value[1]], fallback?.X ?? ZERO_UDIM),
        Y: serializeUDim([value[2], value[3]], fallback?.Y ?? ZERO_UDIM),
      };
    }

    return {
      X: serializeUDim(value[0], fallback?.X ?? ZERO_UDIM),
      Y: serializeUDim(value[1], fallback?.Y ?? ZERO_UDIM),
    };
  }

  if (typeof value !== "object") {
    return fallback;
  }

  const record = value as { X?: unknown; Y?: unknown; x?: unknown; y?: unknown };
  return {
    X: serializeUDim(record.X ?? record.x, fallback?.X ?? ZERO_UDIM),
    Y: serializeUDim(record.Y ?? record.y, fallback?.Y ?? ZERO_UDIM),
  };
}

export function serializeVector2(value: unknown, fallback: SerializedVector2 = ZERO_VECTOR2): SerializedVector2 {
  if (Array.isArray(value)) {
    return {
      X: toFiniteNumber(value[0], fallback.X),
      Y: toFiniteNumber(value[1], fallback.Y),
    };
  }

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as { X?: number; Y?: number; x?: number; y?: number };
  return {
    X: toFiniteNumber(record.X ?? record.x, fallback.X),
    Y: toFiniteNumber(record.Y ?? record.y, fallback.Y),
  };
}
