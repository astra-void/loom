---
"@loom-dev/runtime": minor
"@loom-dev/renderer": minor
"@loom-dev/preview": minor
"@loom-dev/layout": minor
---

Close the high-severity gaps in the Roblox API shim.

An audit of `@loom-dev/runtime` against the real engine surface found 277 missing
pieces; this is the 53 the audit rated high — the ones a everyday roblox-ts UI
hits on its first run.

**The runtime**

- The roblox-ts `Promise` (evaera's), which was absent entirely, so any preview
  that loaded data died on its first call. It is a module-scope binding injected
  by the preview plugin, not a global: the page's `Promise` belongs to the host,
  and the two APIs disagree about `allSettled` and `all`.
- `Instance:Clone()`, with `Archivable`; class read defaults, so a property read
  before it is written yields a typed value the way Roblox reflection does
  instead of `undefined`; a `WaitForChild` that resolves.
- `Random` and `DateTime`, both usually constructed at module scope, where a
  missing global took the whole preview down before it could render.
- `Enum.KeyCode`'s digits, modifiers and gamepad — a keyboard-driven UI could not
  match what the user pressed — plus `Enum.CoreGuiType`, `BorderMode`,
  `MembershipType`, `AssetFetchStatus` and the thumbnail enums.
- `RunService.Stepped` / `IsServer` / `BindToRenderStep`, `UserInputService`'s key
  and touch state, `Player.UserId` / `DisplayName`, `Players:GetUserThumbnailAsync`,
  `ContentProvider`, and services reachable as `game.<Name>` properties.
- Lua-compatible `string.format` specifiers (`%02d`, `%-10s`, `%5.1f`), the
  function and table forms of `string.gsub`, a working `coroutine`, and
  `Array.prototype.sort` accepting roblox-ts's boolean predicate.
- `GuiObject:TweenPosition` / `TweenSize` / `TweenSizeAndPosition`.
- `GuiLabel` and the `ValueBase` family in the class registry, so `IsA` stops
  answering wrongly.
- A signal listener that throws no longer kills the dispatch or the caller.

**The renderer** now fires `MouseButton1Down` / `MouseButton1Up` /
`MouseButton2Click` / `MouseMoved`, which were connectable but never dispatched —
silently doing nothing — and handles keyboard input, which did not exist. It also
paints `BorderSizePixel` / `BorderColor3` / `BorderMode` and `TextScaled`.

**The layout engine** honours `UIScale`, which was accepted and ignored.

**The preview plugin** reads the project's tsconfig `baseUrl` and `paths`, so a
project that imports non-relatively can start at all.

**Breaking:** `EnumItem.Value` now reports the engine's number instead of the
item's position in loom's declaration list. Comparing `.Value` against a
hardcoded integer may need updating; comparing items, or matching on `.Name`, is
unaffected — as is the layout engine, which matches by name.
