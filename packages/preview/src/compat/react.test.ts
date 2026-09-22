/**
 * Behaviour of the `@rbxts/react` compatibility facade, exercised through the
 * real loom renderer rather than in the abstract: a compat module that exports
 * the right *names* but renders nothing would pass a surface test and still be
 * broken. Every assertion here mounts a tree.
 *
 * The surface itself — which names must exist, derived from upstream's own
 * declarations — is `./react.contract.test.ts`.
 */

import {
	type ComputeLayout,
	type MountedWorld,
	mountSync,
} from "@loom-dev/react";
import {
	flushDirtyNow,
	getEventSignal,
	getService,
	type LoomInstance,
} from "@loom-dev/runtime";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, {
	Change,
	Component,
	cloneElement,
	createBinding,
	createContext,
	createElement,
	createRef,
	Event,
	Fragment,
	forwardRef,
	memo,
	None,
	PureComponent,
	ReactComponent,
	ReactPureComponent,
	Tag,
	useContext,
	useRef,
	useState,
} from "./react.ts";

/** Stub layout: every node gets x=0, y=0 and one fixed size. */
const stubLayout: ComputeLayout = (root) => {
	type Node = typeof root;
	const rects: ReturnType<ComputeLayout>["rects"] = {};
	const walk = (node: Node): void => {
		rects[node.id ?? "?"] = { rect: { x: 0, y: 0, width: 100, height: 50 } };
		for (const child of node.children ?? []) walk(child);
	};
	walk(root);
	return { rects };
};

/**
 * `React.Event.X` reads through an index signature, which this repo's
 * `noUncheckedIndexedAccess` widens to `string | undefined`. The namespace is a
 * Proxy that answers for every name, so the narrowing is a fact about the
 * implementation rather than an assumption about the input.
 */
function keyed(namespace: Record<string, string>, name: string): string {
	return namespace[name] as string;
}

let mount: HTMLElement;
let roots: MountedWorld[];

beforeEach(() => {
	document.body.innerHTML = "";
	mount = document.createElement("div");
	// happy-dom reports 0 for client sizes; the world skips zero-sized mounts.
	Object.defineProperty(mount, "clientWidth", { value: 800 });
	Object.defineProperty(mount, "clientHeight", { value: 600 });
	document.body.appendChild(mount);
	roots = [];
});
afterEach(() => {
	for (const root of roots) root.unmount();
});

function render(element: ReactElement): MountedWorld {
	const root = mountSync(element, mount, { computeLayout: stubLayout });
	roots.push(root);
	return root;
}

/**
 * A component that takes no props. Not `Record<string, never>`: that carries a
 * string index signature, which collapses `createElement`'s `ref` to `never`.
 */
type NoProps = Record<never, never>;

/** The rendered DOM node for a `Name`d instance. */
function node(name: string): HTMLElement | null {
	return mount.querySelector(`[data-loom-name="${name}"]`);
}

describe("import shapes", () => {
	it("serves the default, named and namespace forms from one set of values", () => {
		// `import React from`, `import { … } from`, `import * as React from` —
		// all three are in real roblox-ts code, and all three must agree.
		expect(React.Component).toBe(Component);
		expect(React.createElement).toBe(createElement);
		expect(React.ReactComponent).toBe(ReactComponent);
		expect(React.Event).toBe(Event);
		expect(React.Tag).toBe(Tag);
	});

	it("mints prop keys from the Event and Change namespaces", () => {
		expect(Event.Activated).toBe("LoomEvent:Activated");
		expect(Change.AbsoluteSize).toBe("LoomChange:AbsoluteSize");
		// Any signal name, not a fixed list — Roblox has thousands.
		expect(Event.MouseButton1Click).toBe("LoomEvent:MouseButton1Click");
	});
});

describe("the class decorators", () => {
	it("preserve constructor identity", () => {
		class Plain extends Component<{ text: string }> {
			static displayName = "Plain";
			override render(): ReactElement {
				return createElement("textlabel", { Text: this.props.text });
			}
		}
		const decorated = ReactComponent(Plain);
		expect(decorated).toBe(Plain);
		expect(decorated.displayName).toBe("Plain");
		expect(Object.getPrototypeOf(decorated)).toBe(Component);
		expect(decorated.prototype).toBe(Plain.prototype);
	});

	it("preserve constructor identity for pure components too", () => {
		class Pure extends PureComponent<{ text: string }> {
			override render(): ReactElement {
				return createElement("textlabel", { Text: this.props.text });
			}
		}
		expect(ReactPureComponent(Pure)).toBe(Pure);
		expect(Object.getPrototypeOf(Pure)).toBe(PureComponent);
	});

	it("never invokes the constructor", () => {
		let constructed = 0;
		class Counted extends Component {
			constructor(props: NoProps) {
				super(props);
				constructed += 1;
			}
			override render(): null {
				return null;
			}
		}
		ReactComponent(Counted);
		expect(constructed).toBe(0);
	});
});

describe("class components", () => {
	it("renders a decorated class component, with state and lifecycle", () => {
		const lifecycle: string[] = [];

		interface CounterState {
			count: number;
		}

		@ReactComponent
		class Counter extends Component<NoProps, CounterState> {
			override state: CounterState = { count: 0 };
			bump?: () => void;

			override componentDidMount(): void {
				lifecycle.push("mount");
				this.bump = () => {
					this.setState((state) => ({ count: state.count + 1 }));
				};
			}
			override componentDidUpdate(): void {
				lifecycle.push("update");
			}
			override render(): ReactElement {
				return createElement("textbutton", {
					Name: "Counter",
					Text: `Count: ${this.state.count}`,
				});
			}
		}

		const instance = createRef<Counter>();
		render(createElement(Counter, { ref: instance }));

		expect(node("Counter")?.textContent).toBe("Count: 0");
		expect(lifecycle).toEqual(["mount"]);

		instance.current?.bump?.();

		expect(node("Counter")?.textContent).toBe("Count: 1");
		expect(lifecycle).toEqual(["mount", "update"]);
	});

	it("renders a decorated pure component", () => {
		@ReactPureComponent
		class PureLabel extends PureComponent<{ text: string }> {
			override render(): ReactElement {
				return createElement("textlabel", {
					Name: "PureLabel",
					Text: this.props.text,
				});
			}
		}
		render(createElement(PureLabel, { text: "Working" }));
		expect(node("PureLabel")?.textContent).toBe("Working");
	});

	it("contains a render error in a class error boundary", () => {
		class Boundary extends Component<
			{ children?: React.ReactNode },
			{ failed: boolean }
		> {
			override state = { failed: false };
			static getDerivedStateFromError(): { failed: boolean } {
				return { failed: true };
			}
			override render(): ReactElement {
				return this.state.failed
					? createElement("textlabel", { Name: "Fallback", Text: "caught" })
					: createElement(Fragment, null, this.props.children);
			}
		}
		function Boom(): never {
			throw new Error("boom");
		}
		render(createElement(Boundary, null, createElement(Boom)));
		expect(node("Fallback")?.textContent).toBe("caught");
	});
});

describe("the rest of the React surface, through the renderer", () => {
	it("carries refs, context, fragments, memo and forwardRef", () => {
		const Theme = createContext("dark");
		const ref = createRef<LoomInstance>();

		const Boxed = forwardRef<LoomInstance, { name: string }>((props, fwd) =>
			createElement("frame", { Name: props.name, ref: fwd }),
		);
		const Label = memo(function Label(): ReactElement {
			return createElement("textlabel", {
				Name: "Themed",
				Text: useContext(Theme),
			});
		});

		render(
			createElement(
				Theme.Provider,
				{ value: "light" },
				createElement(
					Fragment,
					null,
					createElement(Boxed, { name: "Boxed", ref }),
					createElement(Label),
				),
			),
		);

		expect(node("Boxed")).not.toBeNull();
		expect(ref.current?.ClassName).toBe("Frame");
		expect(node("Themed")?.textContent).toBe("light");
	});

	it("mints bindings from the renderer's own implementation", async () => {
		// Not a re-implementation: the facade re-exports `@loom-dev/react`'s, so a
		// binding from `React.useBinding` and one from the Ripple compatibility
		// hooks are the same object to `isBinding` — one binding kind, one renderer
		// path.
		const adapter = await import("@loom-dev/react");
		expect(createBinding).toBe(adapter.createBinding);
		expect(React.createBinding).toBe(adapter.createBinding);
		const [binding] = createBinding(0);
		expect(adapter.isBinding(binding)).toBe(true);
	});

	it("resolves bindings on host props", () => {
		const [text, setText] = createBinding("before");
		render(createElement("textlabel", { Name: "Bound", Text: text }));
		expect(node("Bound")?.textContent).toBe("before");
		setText("after");
		// A binding write marks the instance dirty and lands on the next scheduler
		// frame rather than a React commit — that is the point of a binding.
		flushDirtyNow();
		expect(node("Bound")?.textContent).toBe("after");
	});
});

describe("React-Lua semantics the facade keeps", () => {
	it("hands a detached ref back as undefined, not null", () => {
		const ref = createRef<LoomInstance>();
		const root = render(createElement("frame", { Name: "Held", ref }));
		expect(ref.current?.ClassName).toBe("Frame");
		root.unmount();
		roots = roots.filter((r) => r !== root);
		// React-Lua sets it back to nil; code checks `ref.current !== undefined`.
		expect(ref.current).toBeUndefined();
	});

	it("does the same for useRef", () => {
		let seen: { current: LoomInstance | undefined } | undefined;
		function Holder(): ReactElement {
			const ref = useRef<LoomInstance>();
			seen = ref;
			return createElement("frame", { Name: "Held", ref });
		}
		const root = render(createElement(Holder));
		expect(seen?.current?.ClassName).toBe("Frame");
		root.unmount();
		roots = roots.filter((r) => r !== root);
		expect(seen?.current).toBeUndefined();
	});

	it("calls a callback ref with undefined on detach, not null", () => {
		const seen: unknown[] = [];
		const ref = (rbx: unknown): void => {
			seen.push(rbx === undefined ? "undefined" : (rbx as LoomInstance).Name);
		};
		const root = render(createElement("frame", { Name: "Held", ref }));
		root.unmount();
		roots = roots.filter((r) => r !== root);
		expect(seen).toEqual(["Held", "undefined"]);
	});

	it("keeps a stable callback ref stable across renders", async () => {
		const seen: unknown[] = [];
		const ref = (rbx: unknown): void => {
			seen.push(rbx === undefined ? "undefined" : "attached");
		};
		let bump: (() => void) | undefined;
		function Holder(): ReactElement {
			const [n, setN] = useState(0);
			bump = () => setN(n + 1);
			return createElement("frame", { Name: `Held${n}`, ref });
		}
		render(createElement(Holder));
		const { act } = await import("react");
		act(() => bump?.());
		// Same callback both renders: React never detaches it in between.
		expect(seen).toEqual(["attached"]);
	});

	it("maps callback refs through the JSX runtime too", async () => {
		const { jsx } = await import("./jsx-runtime.ts");
		const seen: unknown[] = [];
		const ref = (rbx: unknown): void => {
			seen.push(rbx);
		};
		const root = render(jsx("frame", { Name: "Held", ref }) as ReactElement);
		root.unmount();
		roots = roots.filter((r) => r !== root);
		expect(seen.at(-1)).toBeUndefined();
		expect(seen).not.toContain(null);
	});

	it("accepts a Map as cloneElement's config", () => {
		const config = new Map<string, unknown>([["Text", "cloned"]]);
		const original = createElement("textlabel", { Name: "Clone", Text: "x" });
		render(cloneElement(original, config as never));
		expect(node("Clone")?.textContent).toBe("cloned");
	});
});

describe("Event, Change and Tag", () => {
	it("connects the Event handler table with Roblox calling convention", () => {
		const clicks: LoomInstance[] = [];
		let instance: LoomInstance | undefined;
		render(
			createElement("textbutton", {
				Name: "Button",
				ref: (self: LoomInstance | null) => {
					if (self) instance = self;
				},
				Event: { Activated: (rbx: LoomInstance) => clicks.push(rbx) },
			}),
		);
		getEventSignal(instance as LoomInstance, "Activated").fire();
		expect(clicks).toEqual([instance]);
	});

	it("connects the keyed React.Event form to the same signal", () => {
		const clicks: LoomInstance[] = [];
		let instance: LoomInstance | undefined;
		render(
			createElement("textbutton", {
				Name: "Keyed",
				ref: (self: LoomInstance | null) => {
					if (self) instance = self;
				},
				[keyed(Event, "Activated")]: (rbx: LoomInstance) => clicks.push(rbx),
			}),
		);
		getEventSignal(instance as LoomInstance, "Activated").fire();
		expect(clicks).toHaveLength(1);
	});

	it("connects Change handlers in both spellings", () => {
		const seen: string[] = [];
		let instance: LoomInstance | undefined;
		render(
			createElement("frame", {
				Name: "Watched",
				ref: (self: LoomInstance | null) => {
					if (self) instance = self;
				},
				Change: { Visible: () => seen.push("table") },
				[keyed(Change, "BackgroundTransparency")]: () => seen.push("keyed"),
			}),
		);
		const inst = instance as LoomInstance;
		inst.Visible = false;
		inst.BackgroundTransparency = 0.5;
		expect(seen).toEqual(["table", "keyed"]);
	});

	it("applies the Tag prop to CollectionService, and retracts it on unmount", () => {
		const collection = getService("CollectionService") as unknown as {
			HasTag(instance: LoomInstance, tag: string): boolean;
			GetTagged(tag: string): LoomInstance[];
			GetTags(instance: LoomInstance): string[];
		};
		let instance: LoomInstance | undefined;
		const root = render(
			createElement("frame", {
				Name: "Tagged",
				ref: (self: LoomInstance | null) => {
					if (self) instance = self;
				},
				Tag: "surface",
			}),
		);
		const inst = instance as LoomInstance;
		expect(collection.HasTag(inst, "surface")).toBe(true);
		expect(collection.GetTags(inst)).toEqual(["surface"]);
		expect(collection.GetTagged("surface")).toContain(inst);

		root.unmount();
		roots.length = 0;
		expect(collection.HasTag(inst, "surface")).toBe(false);
		expect(collection.GetTagged("surface")).not.toContain(inst);
	});

	it("accepts the keyed React.Tag form", () => {
		const collection = getService("CollectionService") as unknown as {
			HasTag(instance: LoomInstance, tag: string): boolean;
		};
		let instance: LoomInstance | undefined;
		render(
			createElement("frame", {
				Name: "KeyedTag",
				ref: (self: LoomInstance | null) => {
					if (self) instance = self;
				},
				[Tag]: "keyed-surface",
			}),
		);
		expect(collection.HasTag(instance as LoomInstance, "keyed-surface")).toBe(
			true,
		);
	});
});

describe("React.None", () => {
	it("is importable, and the same value on the default export", () => {
		expect(None).toBeDefined();
		expect(React.None).toBe(None);
	});

	it("fails loudly instead of settling into state", () => {
		class WithNone extends Component<NoProps, { a?: number }> {
			override state = { a: 1 };
			clear(): void {
				this.setState({ a: None as unknown as undefined });
			}
			override render(): null {
				return null;
			}
		}
		const instance = createRef<WithNone>();
		render(createElement(WithNone, { ref: instance }));
		expect(() => instance.current?.clear()).toThrow(
			/React\.None is not supported/,
		);
	});

	it("catches None returned from a functional updater too", () => {
		class WithNone extends Component<NoProps, { a?: number }> {
			override state = { a: 1 };
			clear(): void {
				this.setState(() => ({ a: None as unknown as undefined }));
			}
			override render(): null {
				return null;
			}
		}
		const instance = createRef<WithNone>();
		render(createElement(WithNone, { ref: instance }));
		expect(() => instance.current?.clear()).toThrow(
			/React\.None is not supported/,
		);
	});

	it("leaves ordinary setState alone", () => {
		class Plain extends Component<NoProps, { a: number }> {
			override state = { a: 1 };
			bump(): void {
				this.setState({ a: 2 });
			}
			override render(): ReactElement {
				return createElement("textlabel", {
					Name: "Plain",
					Text: String(this.state.a),
				});
			}
		}
		const instance = createRef<Plain>();
		render(createElement(Plain, { ref: instance }));
		instance.current?.bump();
		expect(node("Plain")?.textContent).toBe("2");
	});
});
