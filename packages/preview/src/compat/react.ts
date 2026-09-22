/**
 * `compat/react.ts` — the browser compatibility facade for `@rbxts/react`.
 *
 * The Vite plugin aliases `@rbxts/react` here, so this module *is* the package
 * as far as a previewed roblox-ts source tree is concerned. Its job is to make
 * a normal roblox-ts React file compile and run unchanged, without inventing a
 * second React.
 *
 * Three groups of exports, and the split is the whole design:
 *
 * 1. **Standard React**, forwarded from the one pinned browser `react` the
 *    `@loom-dev/react` reconciler renders with. Forwarded by *identity*:
 *    `Component`, `useState`, `forwardRef` and friends are the very same
 *    values `import … from "react"` yields, never wrappers. Hook dispatch,
 *    `instanceof Component` checks and element-type comparisons therefore all
 *    behave, and there is exactly one React in the graph. The exceptions are
 *    the few calls where React-Lua's own semantics differ and roblox-ts code
 *    depends on the difference — `Children`, `cloneElement`, `createElement`,
 *    `useRef`, `createRef` — each wrapping the browser original rather than
 *    replacing it.
 * 2. **Roblox additions** browser React has no notion of: the `ReactComponent`
 *    / `ReactPureComponent` class decorators, the `Event` / `Change` keyed-prop
 *    namespaces, `Tag`, and `None`.
 * 3. **Loom's bindings** (`createBinding` / `useBinding` / `joinBindings`),
 *    imported from `@loom-dev/react` rather than reimplemented, so a binding
 *    minted here is the same object the renderer resolves — and the same one
 *    the Ripple compatibility hooks mint.
 *
 * Upstream is `@rbxts/react@17.3.7-ts.2`, itself a thin wrapper over the
 * React-Lua runtime in `@rbxts-js/react`. See `./react.contract.test.ts` for
 * the audited inventory: the contract test parses upstream's own `index.d.ts`
 * and fails if a runtime export declared there is missing here.
 *
 * ### Why every re-export is written out
 *
 * `export * from "react"` is not enough. `react` is CommonJS; Vite's dependency
 * optimizer and Rollup both analyse the *facade* statically, and a star
 * re-export of a CJS module leaves the named exports unprovable — the reported
 * failure was Rollup's `"ReactComponent" is not exported by …/react-shim.js`,
 * and a star export produces the same class of error for every other name.
 * Destructuring the namespace into `export const`s makes each name a real,
 * statically visible ESM binding.
 *
 * ### What `createElement` does and does not do
 *
 * Upstream wraps it to lower-case host tags and to fold `Event` / `Change` /
 * `Tag` props into keyed props; under loom the renderer reads those props
 * directly (see `@loom-dev/react`), so none of that is copied. The only thing
 * the wrapper here changes is the `null` a callback ref receives (`./refs.ts`).
 */
import {
	CHANGE_PROP_PREFIX,
	createBinding,
	EVENT_PROP_PREFIX,
	joinBindings,
	TAG_PROP_KEY,
	useBinding,
} from "@loom-dev/react";
import React, { type ReactElement as ReactElementType } from "react";
import { luauRef, withLuauRef } from "./refs.ts";

// --- 1. standard React, by identity ------------------------------------------

/**
 * The React 18 public runtime surface, re-exported as real ESM named exports.
 *
 * Everything upstream's `index.d.ts` declares in value space is here; the
 * extras (`act`, `startTransition`, `useId`, `useDeferredValue`,
 * `useInsertionEffect`, `useSyncExternalStore`, `useTransition`, `version`,
 * `createFactory`) exist in browser React but *not* in React-Lua 17 — see the
 * "Intentional differences" table in the README before reaching for one, since
 * roblox-ts will reject it when the same file is compiled for Roblox.
 */
export const {
	Component,
	Fragment,
	Profiler,
	PureComponent,
	StrictMode,
	Suspense,
	act,
	createContext,
	createFactory,
	forwardRef,
	isValidElement,
	lazy,
	memo,
	startTransition,
	useCallback,
	useContext,
	useDebugValue,
	useDeferredValue,
	useEffect,
	useId,
	useImperativeHandle,
	useInsertionEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useState,
	useSyncExternalStore,
	useTransition,
	version,
} = React;

/**
 * `React.Children`, with **1-based** `map`/`forEach` indices.
 *
 * One of the few places this facade wraps a standard React value instead of
 * forwarding it (`cloneElement`, `createElement`, `useRef` and `createRef`
 * below are the others), because React-Lua deviates here on purpose. `ReactChildren.lua`'s
 * `mapChildren` starts its counter at `1` and passes it to the callback (its
 * own comment marks the spot as a ROBLOX DEVIATION), and `forEachChildren`
 * delegates to it — so roblox-ts code is written against 1-based indices, and
 * a library that has to recover a 0-based position writes `index - 1`.
 *
 * Handing such code browser React's 0-based index shifts every result by one.
 * The symptom is quiet rather than loud: a `<Select>` mapping its options to
 * indices selects, and displays, its neighbour.
 *
 * Only the index the callback sees is changed. React still walks, flattens and
 * re-keys the children itself, so keys and ordering are untouched.
 */
export const Children: typeof React.Children = {
	...React.Children,
	// The generic signatures are React's own; the bodies only shift the index, so
	// the casts are between the same callback shape with a different arity name.
	map: ((children: unknown, fn: (child: unknown, index: number) => unknown) =>
		(React.Children.map as (c: unknown, f: unknown) => unknown)(
			children,
			(child: unknown, index: number) => fn(child, index + 1),
		)) as typeof React.Children.map,
	forEach: ((
		children: unknown,
		fn: (child: unknown, index: number) => void,
	) => {
		(React.Children.forEach as (c: unknown, f: unknown) => void)(
			children,
			(child: unknown, index: number) => {
				fn(child, index + 1);
			},
		);
	}) as typeof React.Children.forEach,
};

/**
 * `cloneElement`, accepting a `Map` as the config.
 *
 * The second place this facade wraps rather than forwards. A roblox-ts `Map`
 * is a Luau table, so upstream's `cloneElement(element, config)` reads a
 * `new Map()` config exactly as it reads `{}` — and libraries build one when
 * the keys are computed (`React.Event[name]`). Browser React only copies own
 * enumerable properties, of which a `Map` has none, so every prop in it would
 * be dropped without a word. The entries are spread into a plain object first;
 * any other config passes through untouched.
 */
export const cloneElement: typeof React.cloneElement = ((
	element: ReactElementType,
	config?: unknown,
	...children: unknown[]
) =>
	(React.cloneElement as (...args: unknown[]) => unknown)(
		element,
		withLuauRef(config instanceof Map ? Object.fromEntries(config) : config),
		...children,
	)) as typeof React.cloneElement;

/**
 * `createElement`, with a callback `ref` called with `undefined` where browser
 * React passes `null` (see `./refs.ts`). JSX reaches the same wrapper through
 * `./jsx-runtime.ts`; this covers code that calls `React.createElement`.
 */
export const createElement: typeof React.createElement = ((
	type: unknown,
	props?: unknown,
	...children: unknown[]
) =>
	(React.createElement as (...args: unknown[]) => unknown)(
		type,
		withLuauRef(props),
		...children,
	)) as typeof React.createElement;

/** `useRef`, with React-Lua's `nil` for a detached ref (see {@link luauRef}). */
export const useRef: typeof React.useRef = ((initial?: unknown) =>
	luauRef(React.useRef(initial))) as typeof React.useRef;

/** `createRef`, with React-Lua's `nil` for a detached ref (see {@link luauRef}). */
export const createRef: typeof React.createRef = (() =>
	luauRef({ current: undefined })) as typeof React.createRef;

// --- 2. Roblox additions ------------------------------------------------------

/**
 * Any class, however constructed — the argument a class decorator receives.
 * `never[]` rather than `any[]`: every constructor signature is assignable to
 * it, and it keeps the decorators out of `any` altogether.
 */
type AnyClass = abstract new (...args: never[]) => unknown;

/**
 * `@ReactComponent` — identity.
 *
 * The decorator exists because React-Lua has no `class` statement: upstream's
 * version copies the decorated table's members onto a fresh
 * `Component:extend(...)` and returns *that*, which is how a roblox-ts class
 * becomes something React-Lua recognises. Browser React needs none of it — a
 * class that `extends Component` already is a React class component — so the
 * only correct browser reading is to hand the constructor straight back.
 *
 * Nothing is wrapped, subclassed, renamed or invoked: `Column === ReactComponent(Column)`,
 * statics keep their identity, `displayName` is untouched, and the prototype
 * chain is the one the author wrote. Anything else would change behaviour that
 * works today (`instanceof`, static inheritance, `Object.getPrototypeOf`) for
 * no gain.
 *
 * Written to satisfy both decorator dialects — TypeScript's legacy
 * `experimentalDecorators` (which roblox-ts projects enable) and the TC39
 * standard decorators esbuild emits otherwise — because a one-parameter
 * identity function is assignable to both decorator shapes.
 */
export function ReactComponent<T extends AnyClass>(target: T): T {
	return target;
}

/**
 * `@ReactPureComponent` — identity, for the same reasons as
 * {@link ReactComponent}. A class that `extends PureComponent` already gets
 * browser React's shallow-compare `shouldComponentUpdate`.
 */
export function ReactPureComponent<T extends AnyClass>(target: T): T {
	return target;
}

/**
 * `React.Event.<SignalName>` / `React.Change.<PropertyName>` → a prop key the
 * `@loom-dev/react` renderer recognises and routes to an instance signal.
 *
 * Upstream mints a unique table per name and the React-Lua host config keys off
 * its `Type` marker. A browser prop bag is a plain object, so loom mints a
 * prefixed *string* instead — same contract (`{ [React.Event.Activated]: fn }`
 * is a valid, stable prop key), and it survives JSON, spreads and dev tooling.
 */
function keyedNamespace(prefix: string): Record<string, string> {
	return new Proxy(Object.create(null) as Record<string, string>, {
		get(_target, name) {
			return typeof name === "string" ? `${prefix}${name}` : undefined;
		},
		// Every name exists, and reporting so keeps `"X" in React.Event` and
		// spread-based prop building honest.
		has() {
			return true;
		},
	});
}

/** `React.Event.<SignalName>` → renderer-recognised keyed prop. */
export const Event: Record<string, string> = keyedNamespace(EVENT_PROP_PREFIX);
/** `React.Change.<PropertyName>` → renderer-recognised keyed prop. */
export const Change: Record<string, string> =
	keyedNamespace(CHANGE_PROP_PREFIX);

/**
 * `React.Tag` — the prop key that tags the host instance with
 * CollectionService.
 *
 * Unlike `Event` / `Change` this is a single key upstream, not an indexed
 * namespace (`props[React.Tag] = props.Tag` is the whole of upstream's
 * handling), so it is one string here. `<frame Tag="x" />` and
 * `<frame {...{ [React.Tag]: "x" }} />` both reach the renderer, which adds and
 * removes the tag on the runtime's real `CollectionService` as the element
 * mounts, updates and unmounts.
 */
export const Tag: string = TAG_PROP_KEY;

/**
 * `React.None` — the React-Lua sentinel that *removes* a key from class
 * component state.
 *
 * It cannot be honoured on browser React, and loom does not pretend otherwise.
 * React's update queue merges partial state with `Object.assign({}, prev,
 * partial)`; a merge can add and overwrite keys but never delete one, and the
 * only place that could change is `Component` itself — which must stay
 * identical to browser React's `Component` for hooks, `instanceof` and the
 * reconciler to work.
 *
 * So `None` is a real, importable value (upstream exports one, and code that
 * merely mentions it must keep compiling), and a `setState` guard turns its use
 * into an immediate, located error rather than letting the sentinel settle into
 * state and corrupt a render several frames later. See {@link installNoneGuard}.
 */
export const None: { readonly _nominal_ReactNone: unique symbol } =
	Object.freeze(
		Object.create(null, {
			[Symbol.toStringTag]: { value: "React.None" },
		}),
	);

const NONE_MESSAGE =
	'[loom] React.None is not supported by loom\'s browser "@rbxts/react" ' +
	"compatibility layer.\n\n" +
	"React-Lua uses None to delete a key from class component state; browser " +
	"React merges partial state with Object.assign, which cannot remove keys, " +
	"and loom must keep React's own Component class untouched so hooks and the " +
	"reconciler keep working.\n\n" +
	"Set the field to `undefined` and treat that as absent, or move the state " +
	"into a hook where you control the whole value.";

/** Reject a partial state containing `None`, naming the offending key. */
function assertNoNone<T>(partial: T): T {
	if (partial === null || typeof partial !== "object") return partial;
	for (const [key, value] of Object.entries(partial)) {
		if (value === None) {
			throw new Error(`${NONE_MESSAGE}\n\nOffending state key: "${key}".`);
		}
	}
	return partial;
}

/** Marker so a re-evaluated module (HMR, a second importer) can't double-wrap. */
const GUARDED = Symbol.for("@loom-dev/preview.none-guard");

type SetState = (partial: unknown, callback?: () => void) => void;

/**
 * Install the `None` guard on the pinned React's `Component` /
 * `PureComponent`.
 *
 * A prototype patch rather than a subclass, deliberately: the contract requires
 * `Component` to *be* browser React's `Component`, so there is nowhere else to
 * put it. The wrapper is a pass-through for every update that contains no
 * `None` — normal React classes are unaffected — and it only ever runs against
 * loom's own React copy, which the preview aliases for the whole previewed app
 * and which never leaves loom's bundle (the Next/Fumadocs integration keeps the
 * gallery in a separate Vite graph, so a host app's React is never touched).
 */
function installNoneGuard(): void {
	const base = React.Component.prototype as unknown as Record<string, unknown>;
	const original = base.setState as SetState;
	if (typeof original !== "function") return;
	if ((original as unknown as Record<symbol, unknown>)[GUARDED]) return;

	function setState(this: unknown, partial: unknown, callback?: () => void) {
		return original.call(
			this,
			typeof partial === "function"
				? (state: unknown, props: unknown) =>
						assertNoNone(
							(partial as (s: unknown, p: unknown) => unknown)(state, props),
						)
				: assertNoNone(partial),
			callback,
		);
	}
	(setState as unknown as Record<symbol, unknown>)[GUARDED] = true;

	// PureComponent gets its own copy of `setState` from React's
	// `Object.assign(pureComponentPrototype, Component.prototype)`, so both
	// prototypes need patching — but only where the original is still in place.
	for (const prototype of [
		React.Component.prototype,
		React.PureComponent.prototype,
	] as unknown as Array<Record<string, unknown>>) {
		if (prototype.setState === original) prototype.setState = setState;
	}
}

installNoneGuard();

// --- 3. loom bindings ---------------------------------------------------------

/**
 * Bindings live in `@loom-dev/react` (the renderer resolves them when applying
 * props) and are re-exported here because roblox-ts code reaches them through
 * `@rbxts/react` — where upstream declares all three. Importing rather than
 * reimplementing keeps one identity, so a binding minted by `React.useBinding`
 * and one minted by loom's Ripple compatibility hooks are the same kind of
 * object to the renderer.
 */
export { createBinding, joinBindings, useBinding };

// --- 4. the default export ----------------------------------------------------

/**
 * `import React from "@rbxts/react"` — the same values as the named exports,
 * so `React.useState === useState` and `React.Event === Event`.
 *
 * Built by spreading the pinned React (which carries anything browser React
 * adds that is not named above, `__SECRET_INTERNALS_…` included) and then the
 * loom additions, rather than by listing names twice and letting the two drift.
 */
const merged = Object.assign({}, React, {
	Change,
	// Spreading React brought in its 0-based `Children`; the namespace form has
	// to be the same 1-based one the named export is, or `React.Children.map`
	// and `Children.map` would disagree inside one file.
	Children,
	cloneElement,
	createElement,
	createRef,
	Event,
	None,
	ReactComponent,
	ReactPureComponent,
	Tag,
	createBinding,
	joinBindings,
	useBinding,
	useRef,
});

export default merged;

// --- 5. type space ------------------------------------------------------------

/**
 * `Binding<T>` — upstream declares it here, and loom's renderer is what
 * implements it, so the type comes from `@loom-dev/react` alongside the three
 * functions that mint one.
 */
export type { Binding } from "@loom-dev/react";
/**
 * Every type upstream's `index.d.ts` declares that browser React also has,
 * forwarded in type space only — a `.d.ts` declaration is not a runtime value,
 * and fabricating an export for one is exactly how a module ends up promising
 * something Rollup cannot deliver.
 *
 * Written out rather than star-exported because `@types/react` is an
 * `export =` module, which TypeScript refuses to `export *` from. The list is
 * the intersection of the two packages' type spaces, so it is auditable: the
 * ten upstream types with no browser counterpart are
 * `AllowRefs`, `Element`, `Error`, `InferEnumNames`, `InstanceAttributes`,
 * `InstanceChangeEvent`, `InstanceEvent`, `InstanceProps` and
 * `SchedulerInteraction` — all of them descriptions of Roblox *host* elements
 * or of React-Lua's own error/scheduler shapes. Host-element typing under loom
 * comes from `@loom-dev/react`'s global JSX declaration instead, and `Binding`
 * is re-exported below from the implementation that actually backs it.
 */
export type {
	Attributes,
	CElement,
	ChildContextProvider,
	ClassAttributes,
	ClassicComponent,
	ClassicComponentClass,
	ClassicElement,
	ClassType,
	ComponentClass,
	ComponentElement,
	ComponentLifecycle,
	ComponentProps,
	ComponentPropsWithoutRef,
	ComponentPropsWithRef,
	ComponentRef,
	ComponentSpec,
	ComponentState,
	ComponentType,
	Consumer,
	ConsumerProps,
	Context,
	ContextType,
	CustomComponentPropsWithRef,
	DependencyList,
	DeprecatedLifecycle,
	Dispatch,
	DispatchWithoutAction,
	EffectCallback,
	ElementRef,
	ElementType,
	ErrorInfo,
	ExoticComponent,
	FC,
	ForwardedRef,
	ForwardRefExoticComponent,
	ForwardRefRenderFunction,
	FunctionComponent,
	FunctionComponentElement,
	GetDerivedStateFromError,
	GetDerivedStateFromProps,
	JSXElementConstructor,
	Key,
	LazyExoticComponent,
	LegacyRef,
	MemoExoticComponent,
	Mixin,
	MutableRefObject,
	NamedExoticComponent,
	NewLifecycle,
	ProfilerOnRenderCallback,
	ProfilerProps,
	PropsWithChildren,
	PropsWithoutRef,
	PropsWithRef,
	Provider,
	ProviderExoticComponent,
	ProviderProps,
	ReactChild,
	ReactChildren,
	ReactComponentElement,
	ReactElement,
	ReactFragment,
	ReactInstance,
	ReactNode,
	ReactPortal,
	ReactPropTypes,
	Reducer,
	ReducerAction,
	ReducerState,
	ReducerStateWithoutAction,
	ReducerWithoutAction,
	Ref,
	RefAttributes,
	RefCallback,
	RefObject,
	Requireable,
	SetStateAction,
	StaticLifecycle,
	SuspenseProps,
	ValidationMap,
	Validator,
	VFC,
	VoidFunctionComponent,
	WeakValidationMap,
} from "react";

/**
 * `Element` — React-Lua's name for a rendered element. Aliased rather than
 * omitted because roblox-ts components routinely annotate their return type
 * with it.
 */
export type Element = ReactElementType;
