import {
	findMockAncestorOfClass,
	findMockAncestorWhichIsA,
	type MockInstanceLike,
} from "./mockInstance";

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

type MockPath = readonly PropertyKey[];

type MockSignalConnection = {
	Connected: boolean;
	Disconnect(): void;
};

type MockSignal = {
	Connect(listener?: (...args: unknown[]) => void): MockSignalConnection;
};

function createMockVector2(x: number, y: number) {
	return { X: x, Y: y };
}

function createMockUDim(offset: number, scale: number) {
	return { Offset: offset, Scale: scale };
}

function createMockUDim2() {
	return {
		X: createMockUDim(0, 0),
		Y: createMockUDim(0, 0),
	};
}

function createMockSignal(): MockSignal {
	return {
		Connect(listener?: (...args: unknown[]) => void) {
			const connection: MockSignalConnection = {
				Connected: true,
				Disconnect() {
					connection.Connected = false;
				},
			};

			setTimeout(() => {
				if (connection.Connected) {
					listener?.();
				}
			}, 0);

			return connection;
		},
	};
}

const _mockScreenGui = {
	AbsolutePosition: createMockVector2(0, 0),
	AbsoluteSize: createMockVector2(1000, 1000),
	AbsoluteWindowSize: createMockVector2(0, 0),
	CanvasSize: createMockUDim2(),
	ClassName: "ScreenGui",
	GetFullName() {
		return "MockScreenGui";
	},
	GetPropertyChangedSignal() {
		return createMockSignal();
	},
	FindFirstAncestorOfClass(className: string): MockInstanceLike | undefined {
		return findMockAncestorOfClass(this, className);
	},
	FindFirstAncestorWhichIsA(className: string): MockInstanceLike | undefined {
		return findMockAncestorWhichIsA(this, className);
	},
	IsA(name: string) {
		return (
			name === "ScreenGui" || name === "LayerCollector" || name === "Instance"
		);
	},
	Name: "MockScreenGui",
	Parent: undefined as MockInstanceLike | undefined,
	TextBounds: createMockVector2(0, 0),
};

export type UniversalRobloxMock = ((
	...args: unknown[]
) => UniversalRobloxMock) &
	(new (
		...args: unknown[]
	) => UniversalRobloxMock) & {
		[key: string]: UniversalRobloxMock;
		[key: number]: UniversalRobloxMock;
	};

export interface UniversalRobloxModuleMock {
	readonly default: UniversalRobloxMock;
	readonly [key: string]: UniversalRobloxMock;
	readonly [key: number]: UniversalRobloxMock;
}

function formatPath(path: MockPath) {
	if (path.length === 0) {
		return "RobloxMock";
	}

	return path
		.map((segment) => {
			if (typeof segment === "symbol") {
				return segment.toString();
			}

			return String(segment);
		})
		.join(".");
}

function createUniversalRobloxMockInternal(
	path: MockPath = [],
): UniversalRobloxMock {
	const members = new Map<PropertyKey, UniversalRobloxMock>();
	const label = formatPath(path);
	const proxy: UniversalRobloxMock = (() => {
		const callableTarget = function universalRobloxMock() {
			return proxy;
		} as unknown as UniversalRobloxMock;

		const resolveMember = (key: PropertyKey): unknown => {
			if (key === "then") {
				return undefined;
			}

			if (key === "__esModule") {
				return true;
			}

			if (key === Symbol.toPrimitive) {
				return (hint: string) => {
					if (hint === "number") {
						return 0;
					}

					return label;
				};
			}

			if (key === Symbol.iterator) {
				return function* emptyIterator() {};
			}

			if (key === Symbol.asyncIterator) {
				return async function* emptyAsyncIterator() {};
			}

			if (key === Symbol.toStringTag) {
				return "RobloxMock";
			}

			if (key === inspectSymbol) {
				return () => `[${label}]`;
			}

			if (key === "toString") {
				return () => `[${label}]`;
			}

			if (key === "valueOf") {
				return () => 0;
			}

			if (key === "toJSON") {
				return () => label;
			}

			if (key === "displayName") {
				return label;
			}

			if (key === "Parent") {
				return undefined;
			}

			if (key === "AbsolutePosition") {
				return createMockVector2(0, 0);
			}

			if (key === "AbsoluteSize") {
				return createMockVector2(1000, 1000);
			}

			if (key === "AbsoluteWindowSize") {
				return createMockVector2(0, 0);
			}

			if (key === "CanvasSize") {
				return createMockUDim2();
			}

			if (key === "GetPropertyChangedSignal") {
				return () => createMockSignal();
			}

			if (key === "FindFirstAncestorWhichIsA") {
				return (className: string): MockInstanceLike | undefined =>
					findMockAncestorWhichIsA(proxy, className);
			}

			if (key === "FindFirstAncestorOfClass") {
				return (className: string): MockInstanceLike | undefined =>
					findMockAncestorOfClass(proxy, className);
			}

			if (key === "default") {
				return proxy;
			}

			if (key === "prototype") {
				return proxy;
			}

			if (key === "name") {
				return label;
			}

			if (key === "length") {
				return 0;
			}

			if (key === "TextBounds") {
				return createMockVector2(0, 0);
			}

			const cached = members.get(key);
			if (cached) {
				return cached;
			}

			const nextMember: UniversalRobloxMock = createUniversalRobloxMockInternal(
				[...path, key],
			);
			members.set(key, nextMember);
			return nextMember;
		};

		return new Proxy(callableTarget, {
			apply() {
				return proxy;
			},
			construct() {
				return proxy;
			},
			defineProperty() {
				return true;
			},
			deleteProperty() {
				return true;
			},
			get(target, key, receiver) {
				if (Reflect.has(target, key)) {
					return Reflect.get(target, key, receiver);
				}

				return resolveMember(key);
			},
			getOwnPropertyDescriptor(target, key) {
				const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
				if (descriptor) {
					return descriptor;
				}

				const value: unknown = resolveMember(key);
				if (value === undefined) {
					return undefined;
				}

				return {
					configurable: true,
					enumerable: key === "default",
					value,
					writable: true,
				};
			},
			getPrototypeOf() {
				return Function.prototype;
			},
			has() {
				return true;
			},
			ownKeys(target) {
				return Reflect.ownKeys(target);
			},
			set() {
				return true;
			},
			setPrototypeOf() {
				return true;
			},
		});
	})();

	return proxy;
}

function createUniversalRobloxModuleMockInternal(
	mock: UniversalRobloxMock,
): UniversalRobloxModuleMock {
	return new Proxy(Object.create(null) as UniversalRobloxModuleMock, {
		defineProperty() {
			return true;
		},
		deleteProperty() {
			return true;
		},
		get(_target, key) {
			if (key === "then") {
				return undefined;
			}

			if (key === "__esModule") {
				return true;
			}

			if (key === Symbol.toPrimitive) {
				return () => "[RobloxModuleMock]";
			}

			if (key === Symbol.toStringTag) {
				return "RobloxModuleMock";
			}

			if (key === inspectSymbol) {
				return () => "[RobloxModuleMock]";
			}

			if (key === "default") {
				return mock;
			}

			return mock;
		},
		getOwnPropertyDescriptor(_target, key) {
			return {
				configurable: true,
				enumerable: key === "default",
				value: mock,
				writable: false,
			};
		},
		has() {
			return true;
		},
		ownKeys() {
			return ["default"];
		},
		set() {
			return true;
		},
	}) as UniversalRobloxModuleMock;
}

export function createUniversalRobloxMock() {
	return createUniversalRobloxMockInternal();
}

export function createUniversalRobloxModuleMock() {
	return createUniversalRobloxModuleMockInternal(
		createUniversalRobloxMockInternal(),
	);
}

export const robloxMock = createUniversalRobloxMockInternal();
export const robloxModuleMock =
	createUniversalRobloxModuleMockInternal(robloxMock);

export default robloxMock;
