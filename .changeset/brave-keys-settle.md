---
"@loom-dev/runtime": minor
"@loom-dev/renderer": patch
"@loom-dev/react": patch
"@loom-dev/preview": patch
"@loom-dev/layout": patch
---

Fix interaction faults found by running a real roblox-ts component library (rbxts-react-clean-ui) through the preview, and close more runtime gaps.

**React-Lua semantics the preview was missing**

- A host instance's `Name` now comes from its element's `key`, or from the nearest keyed ancestor, as React-Lua sets it. `<frame key="Content">` had kept its class name, so every `FindFirstChild("Content")` returned nil.
- A detached ref is `undefined`, not `null`, for `useRef`, `createRef` and callback refs alike. roblox-ts code checks `ref.current !== undefined`, which `null` got past. Previewed JSX now compiles through a wrapped `@rbxts/react/jsx-runtime` to make this work.
- `cloneElement` accepts a `Map` as its config, as upstream accepts any table.
- `.get/.set/.has/.delete` on a plain table cast to `Map`, and `str.match(luaPattern)`, now behave as they do in Luau. The preview rewrites those call sites in previewed source to symbol-keyed runtime methods. They had thrown: `props.get is not a function`, and `null[0]` from JS's RegExp `match`.

**Layout and rendering**

- `AutomaticSize` height can grow past the parent again; only width is capped. The expanding-panel idiom (an auto-height content frame inside a clip whose height tweens toward the content's `AbsoluteSize.Y`) had frozen partway open.
- The first layout waits for any web font it measured that has not loaded yet, at most 1.5s per font. Measuring against the fallback font had fed wrong widths to `AbsoluteSize` listeners, and a component that sizes from them could lock those widths in: a table column clipped its text.
- Painted text is tightened to stay inside the engine-width box when the browser shapes a line wider than the engine does.
- A `TextBox` shows the text a `Changed` handler rewrote in the same keystroke (the input-validation idiom). The rejected character had stayed on screen.

**Assets**

- Dev asset lookups are batched, up to 100 ids per thumbnail request with at most two requests in flight, and throttled lookups are retried, honouring `Retry-After`. Icon-heavy pages had hit the thumbnail API's rate limit, and icons went missing at random.

**Runtime**

- `ContextActionService` bindings fire: priority order, and `Sink` stops the chain. Also added: `UnbindAllActions`, `GetBoundActionInfo`, the touch-button members, and `UserInputService.LastInputType`.
- `Changed` and `AncestryChanged` fire the way the engine fires them. Value types compare by value, so rewriting the same `UDim2` no longer fires a change. `Changed` fires for `Parent` and for the `Absolute*` properties. `Destroy` raises the ancestry signals and then locks `Parent`.
- The Luau library stops returning wrong answers without an error: `tostring` uses `%.14g`, the full set of Lua pattern classes is supported, and a pattern loom cannot translate throws instead of silently matching nothing.
- New datatypes: `NumberRange` and `Content`. `Color3.fromHex` accepts the 3-digit form. Added `UDim2.Width`/`Height`, the `Vector2`/`Vector3` rounding and comparison helpers, and `Font.fromId`.
