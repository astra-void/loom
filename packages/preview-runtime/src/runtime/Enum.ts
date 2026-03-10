const ENUM_KEY = Symbol.for("lattice-ui.preview-runtime.Enum");
const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

type EnumProxy = Record<PropertyKey, unknown>;

export interface PreviewEnumItem {
  readonly [key: string]: unknown;
  readonly EnumType: PreviewEnumCategory;
  readonly Name: string;
  readonly Value: number;
  IsA(name: string): boolean;
}

export interface PreviewEnumCategory {
  readonly [key: string]: unknown;
  readonly Name: string;
  GetEnumItems(): PreviewEnumItem[];
  FromName(name: string): PreviewEnumItem;
  FromValue(value: number): PreviewEnumItem;
}

export interface PreviewEnumRoot {
  readonly [key: string]: unknown;
  GetEnums(): PreviewEnumCategory[];
}

const proxyCache = new Map<string, EnumProxy>();

function formatPath(path: readonly string[]) {
  if (path.length === 0) {
    return "Enum";
  }

  return `Enum.${path.join(".")}`;
}

function getProxyKey(path: readonly string[]) {
  return path.join(".");
}

function hashPath(path: readonly string[]) {
  const joined = formatPath(path);
  let hash = 2166136261;

  for (const character of joined) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getItemValue(path: readonly string[]) {
  const itemName = path[path.length - 1];
  const fromValueMatch = /^Value(-?\d+)$/.exec(itemName ?? "");
  if (fromValueMatch) {
    return Number(fromValueMatch[1]);
  }

  return hashPath(path);
}

function getItemProxy(path: readonly string[]) {
  return createEnumProxy(path) as unknown as PreviewEnumItem;
}

function getCategoryProxy(path: readonly string[]) {
  return createEnumProxy(path) as unknown as PreviewEnumCategory;
}

function getReservedKeys(path: readonly string[]) {
  if (path.length === 0) {
    return ["GetEnums"];
  }

  if (path.length === 1) {
    return ["Name", "GetEnumItems", "FromName", "FromValue"];
  }

  return ["EnumType", "Name", "Value", "IsA"];
}

function resolveProxyMember(path: readonly string[], property: PropertyKey): unknown {
  if (property === "then") {
    return undefined;
  }

  if (property === inspectSymbol) {
    return () => formatPath(path);
  }

  if (property === Symbol.toStringTag) {
    return path.length >= 2 ? "EnumItem" : "Enum";
  }

  if (property === Symbol.toPrimitive) {
    return (hint: string) => {
      if (hint === "number" && path.length >= 2) {
        return getItemValue(path);
      }

      return formatPath(path);
    };
  }

  if (property === "toString") {
    return () => formatPath(path);
  }

  if (property === "valueOf") {
    return () => (path.length >= 2 ? getItemValue(path) : 0);
  }

  if (property === "toJSON") {
    if (path.length >= 2) {
      return () => ({
        Name: path[path.length - 1],
        Value: getItemValue(path),
      });
    }

    return () => formatPath(path);
  }

  if (path.length === 0) {
    if (property === "GetEnums") {
      return () => [];
    }

    if (property === "Name") {
      return "Enum";
    }

    if (typeof property === "string") {
      return getCategoryProxy([property]);
    }

    return undefined;
  }

  if (path.length === 1) {
    const categoryName = path[0];

    if (property === "Name") {
      return categoryName;
    }

    if (property === "GetEnumItems") {
      return () => [];
    }

    if (property === "FromName") {
      return (itemName: string) => getItemProxy([categoryName, String(itemName)]);
    }

    if (property === "FromValue") {
      return (value: number) => getItemProxy([categoryName, `Value${Number(value)}`]);
    }

    if (typeof property === "string") {
      return getItemProxy([categoryName, property]);
    }

    return undefined;
  }

  const categoryName = path[0];
  const itemName = path[path.length - 1];

  if (property === "Name") {
    return itemName;
  }

  if (property === "Value") {
    return getItemValue(path);
  }

  if (property === "EnumType") {
    return getCategoryProxy([categoryName]);
  }

  if (property === "IsA") {
    return (name: string) => name === "EnumItem" || name === categoryName || name === itemName;
  }

  if (typeof property === "string") {
    return getItemProxy([...path, property]);
  }

  return undefined;
}

function createEnumProxy(path: readonly string[]): EnumProxy {
  const cacheKey = getProxyKey(path);
  const cached = proxyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const reservedKeys = getReservedKeys(path);
  const proxy = new Proxy(Object.create(null) as EnumProxy, {
    get(_target, property) {
      return resolveProxyMember(path, property);
    },
    getOwnPropertyDescriptor(_target, property) {
      const value = resolveProxyMember(path, property);
      if (value === undefined) {
        return undefined;
      }

      return {
        configurable: true,
        enumerable: typeof property === "string" && reservedKeys.includes(property),
        value,
        writable: false,
      };
    },
    has() {
      return true;
    },
    ownKeys() {
      return reservedKeys;
    },
  });

  proxyCache.set(cacheKey, proxy);
  return proxy;
}

type GlobalEnum = typeof globalThis & {
  [ENUM_KEY]?: PreviewEnumRoot;
};

function getEnumRoot() {
  const globalEnum = globalThis as GlobalEnum;

  if (!globalEnum[ENUM_KEY]) {
    globalEnum[ENUM_KEY] = createEnumProxy([]) as unknown as PreviewEnumRoot;
  }

  return globalEnum[ENUM_KEY];
}

export const Enum: PreviewEnumRoot = getEnumRoot();

export default Enum;
