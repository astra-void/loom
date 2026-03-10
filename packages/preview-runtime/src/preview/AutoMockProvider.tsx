import React from "react";
import type { PreviewComponentPropsMetadata, PreviewPropMetadata } from "./previewTypes";

type PreviewPrint = (...args: unknown[]) => void;
type DeepMockMember = ((...args: unknown[]) => unknown) & Record<PropertyKey, unknown>;

export type PreviewAutoMockableComponent<Props extends Record<string, unknown> = Record<string, unknown>> =
  React.ComponentType<Props> & {
    __previewProps?: PreviewComponentPropsMetadata;
  };

type AutoMockProviderProps<Props extends Record<string, unknown>> = {
  component: PreviewAutoMockableComponent<Props>;
  props?: Partial<Props> | Record<string, unknown>;
};

const SMART_STRING_HEURISTICS: Array<{
  matches: (normalizedPropName: string) => boolean;
  value: string;
}> = [
  {
    matches: (normalizedPropName) => normalizedPropName.includes("id"),
    value: "mock-id-123",
  },
  {
    matches: (normalizedPropName) => normalizedPropName.includes("label"),
    value: "Example Label",
  },
  {
    matches: (normalizedPropName) => normalizedPropName.includes("title"),
    value: "Example Title",
  },
  {
    matches: (normalizedPropName) => normalizedPropName.includes("name"),
    value: "Example Name",
  },
];

function hasOwnProperty(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizePropName(propName: string) {
  const pathSegments = propName.split(".");
  const leafName = pathSegments[pathSegments.length - 1] ?? propName;
  return leafName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function createSmartString(propName: string) {
  const normalizedPropName = normalizePropName(propName);
  const matchedHeuristic = SMART_STRING_HEURISTICS.find((heuristic) => heuristic.matches(normalizedPropName));
  return matchedHeuristic?.value ?? "Mock Text";
}

function shouldUseIndexHeuristic(propName: string) {
  return normalizePropName(propName).includes("index");
}

function getPreviewPrinter() {
  const candidate = (globalThis as { print?: PreviewPrint }).print;
  return typeof candidate === "function" ? candidate : (...args: unknown[]) => console.log(...args);
}

function formatMockPath(path: readonly PropertyKey[]) {
  return path.length === 0 ? "AutoMockObject" : path.map((segment) => String(segment)).join(".");
}

function createDeepMockMember(path: readonly PropertyKey[]): DeepMockMember {
  const memberCache = new Map<PropertyKey, DeepMockMember>();
  const label = formatMockPath(path);

  const resolveMember = (key: PropertyKey) => {
    if (key === "then") {
      return undefined;
    }

    if (key === Symbol.iterator) {
      return function* emptyIterator() {};
    }

    if (key === Symbol.asyncIterator) {
      return async function* emptyAsyncIterator() {};
    }

    if (key === Symbol.toPrimitive) {
      return () => label;
    }

    if (key === Symbol.toStringTag) {
      return "AutoMockMember";
    }

    if (key === "toJSON") {
      return () => ({});
    }

    if (key === "toString") {
      return () => `[${label}]`;
    }

    if (key === "valueOf") {
      return () => 0;
    }

    const cached = memberCache.get(key);
    if (cached) {
      return cached;
    }

    const nextMember = createDeepMockMember([...path, key]);
    memberCache.set(key, nextMember);
    return nextMember;
  };

  const callable = (() => createDeepMockObject(path)) as DeepMockMember;
  return new Proxy(callable, {
    apply() {
      return createDeepMockObject(path);
    },
    get(_target, key) {
      return resolveMember(key);
    },
    getOwnPropertyDescriptor(_target, key) {
      const value = resolveMember(key);
      if (value === undefined) {
        return undefined;
      }

      return {
        configurable: true,
        enumerable: false,
        value,
        writable: true,
      };
    },
    has() {
      return true;
    },
    ownKeys() {
      return [];
    },
    set() {
      return true;
    },
  });
}

function createDeepMockObject(path: readonly PropertyKey[] = []) {
  const memberCache = new Map<PropertyKey, DeepMockMember>();
  const label = formatMockPath(path);

  const resolveMember = (key: PropertyKey) => {
    if (key === "then") {
      return undefined;
    }

    if (key === Symbol.iterator) {
      return function* emptyIterator() {};
    }

    if (key === Symbol.asyncIterator) {
      return async function* emptyAsyncIterator() {};
    }

    if (key === Symbol.toPrimitive) {
      return () => label;
    }

    if (key === Symbol.toStringTag) {
      return "AutoMockObject";
    }

    if (key === "toJSON") {
      return () => ({});
    }

    if (key === "toString") {
      return () => `[${label}]`;
    }

    if (key === "valueOf") {
      return () => 0;
    }

    const cached = memberCache.get(key);
    if (cached) {
      return cached;
    }

    const nextMember = createDeepMockMember([...path, key]);
    memberCache.set(key, nextMember);
    return nextMember;
  };

  return new Proxy(Object.create(null) as Record<PropertyKey, unknown>, {
    get(_target, key) {
      return resolveMember(key);
    },
    getOwnPropertyDescriptor(_target, key) {
      const value = resolveMember(key);
      if (value === undefined) {
        return undefined;
      }

      return {
        configurable: true,
        enumerable: false,
        value,
        writable: true,
      };
    },
    has() {
      return true;
    },
    ownKeys() {
      return [];
    },
    set() {
      return true;
    },
  });
}

function shouldAutoMockOptionalProp(definition: PreviewPropMetadata, propName: string): boolean {
  if (shouldUseIndexHeuristic(propName)) {
    return true;
  }

  switch (definition.kind) {
    case "array":
    case "boolean":
    case "function":
    case "literal":
    case "number":
    case "react-element":
    case "react-node":
    case "string":
      return true;
    case "union":
      return (definition.unionTypes ?? []).some((option) => shouldAutoMockOptionalProp(option, propName));
    default:
      return false;
  }
}

function createObjectMock(definition: PreviewPropMetadata, propName: string) {
  if (!definition.properties || Object.keys(definition.properties).length === 0) {
    return createDeepMockObject([propName]);
  }

  const value: Record<string, unknown> = {};
  for (const [childName, childDefinition] of Object.entries(definition.properties)) {
    const childPropName = `${propName}.${childName}`;
    if (!childDefinition.required && !shouldAutoMockOptionalProp(childDefinition, childPropName)) {
      continue;
    }

    value[childName] = createMockValue(childDefinition, childPropName);
  }

  return value;
}

function createUnionMock(definition: PreviewPropMetadata, propName: string) {
  for (const option of definition.unionTypes ?? []) {
    if (!definition.required && !option.required && !shouldAutoMockOptionalProp(option, propName)) {
      continue;
    }

    const value = createMockValue(option, propName);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function createMockValue(definition: PreviewPropMetadata, propName: string): unknown {
  if (shouldUseIndexHeuristic(propName) && definition.kind !== "boolean" && definition.kind !== "function") {
    return 0;
  }

  switch (definition.kind) {
    case "boolean":
      return false;
    case "string":
      return createSmartString(propName);
    case "number":
      return 0;
    case "bigint":
      return BigInt(0);
    case "function":
      return () => getPreviewPrinter()(`[AutoMock] ${propName} called`);
    case "literal":
      return definition.literal;
    case "array":
      return [];
    case "object":
      return createObjectMock(definition, propName);
    case "react-element":
      return React.createElement("span", undefined, createSmartString(propName));
    case "react-node":
      return createSmartString(propName);
    case "union":
      return createUnionMock(definition, propName);
    case "unknown":
      return createDeepMockObject([propName]);
    default:
      return undefined;
  }
}

export function buildAutoMockProps<Props extends Record<string, unknown>>(
  component: PreviewAutoMockableComponent<Props>,
  explicitProps?: Partial<Props> | Record<string, unknown>,
) {
  const metadata = component.__previewProps;
  const resolvedProps: Record<string, unknown> = explicitProps ? { ...explicitProps } : {};

  if (!metadata) {
    return resolvedProps as Props;
  }

  for (const [propName, definition] of Object.entries(metadata.props)) {
    if (hasOwnProperty(resolvedProps, propName) && resolvedProps[propName] !== undefined) {
      continue;
    }

    if (!definition.required && !shouldAutoMockOptionalProp(definition, propName)) {
      continue;
    }

    const mockValue = createMockValue(definition, propName);
    if (mockValue !== undefined || definition.required) {
      resolvedProps[propName] = mockValue;
    }
  }

  return resolvedProps as Props;
}

export function withAutoMockedProps<Props extends Record<string, unknown>>(
  component: PreviewAutoMockableComponent<Props>,
) {
  function AutoMockedComponent(props: Partial<Props>) {
    return React.createElement(component, buildAutoMockProps(component, props));
  }

  AutoMockedComponent.displayName = `WithAutoMockedProps(${component.displayName ?? component.name ?? "Component"})`;
  return AutoMockedComponent;
}

export function AutoMockProvider<Props extends Record<string, unknown>>(props: AutoMockProviderProps<Props>) {
  return React.createElement(props.component, buildAutoMockProps(props.component, props.props));
}
