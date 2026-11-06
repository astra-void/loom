// Writes packages/runtime/src/engine-defaults.ts: the value a fresh instance of
// each UI class reads for every property nothing has written yet.
//
// loom hand-writes the defaults it paints by (`CLASS_DEFAULTS` in instance.ts).
// Every other property used to read as nil, so code that read one before writing
// it (`stroke.Thickness + 2`, `padding.PaddingTop.Offset`) got nil where Studio
// gives a value. This table answers for the rest. Hand-written defaults and
// property readers still win over it.
//
// Source: the `Default` fields of Roblox's full API dump, as published by
// Roblox-Client-Tracker. `@rbxts/types` carries no default values.
//
// usage: node scripts/gen-engine-defaults.mjs [path/to/Full-API-Dump.json]
//        (with no path, the dump is fetched from Roblox-Client-Tracker)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRACKER =
	"https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox";

const path = process.argv[2];
const dump = path
	? JSON.parse(readFileSync(path, "utf8"))
	: await (await fetch(`${TRACKER}/Full-API-Dump.json`)).json();
const version = path
	? "a local Full-API-Dump.json"
	: `Roblox ${(await (await fetch(`${TRACKER}/version.txt`)).text()).trim()}`;

const byName = new Map(dump.Classes.map((c) => [c.Name, c]));
function chain(name) {
	const out = [];
	for (let n = name; n && byName.has(n); n = byName.get(n).Superclass)
		out.push(n);
	return out;
}

// The 2D UI tree, its modifiers, and the two non-UI classes UI code reaches for
// (a click `Sound`, an `IntValue` as shared state). 3D classes are left out:
// nothing in a preview simulates them.
const ROOTS = new Set(["GuiBase2d", "UIBase", "Sound", "ValueBase"]);
const EXCLUDED_ROOTS = new Set(["PluginGui"]);

// Members a script cannot read, or that only exist for old content.
const SKIP_TAGS = new Set([
	"ReadOnly",
	"Deprecated",
	"Hidden",
	"NotScriptable",
	"WriteOnly",
	"NotBrowsable",
]);

// Left absent on purpose. With no value, the renderer paints these with its own
// fallbacks (a sans face at 14px), and the adapters measure text by reading them
// back. A `Legacy` font answered here would be measured in Arial and painted in
// the sans fallback, and the two would disagree about where a line wraps.
// `TextSize` and `TextWrapped` have readers of their own in instance.ts.
const EXCLUDED_PROPS = new Set([
	"Font",
	"FontFace",
	"FontSize",
	"TextSize",
	"TextWrapped",
	"TextWrap",
]);

// Abstract classes have no `Default` in the dump (it reports
// `__api_dump_class_not_creatable__`), so their properties are filled from the
// creator documentation's defaults. Only values the docs state outright are here.
const ABSTRACT = {
	GuiBase2d: {
		AutoLocalize: "b1",
		SelectionGroup: "b0",
		SelectionBehaviorUp: "eSelectionBehavior.Escape",
		SelectionBehaviorDown: "eSelectionBehavior.Escape",
		SelectionBehaviorLeft: "eSelectionBehavior.Escape",
		SelectionBehaviorRight: "eSelectionBehavior.Escape",
	},
	GuiObject: {
		AutomaticSize: "eAutomaticSize.None",
		SizeConstraint: "eSizeConstraint.RelativeXY",
		SelectionOrder: "n0",
	},
	GuiButton: {
		AutoButtonColor: "b1",
		Modal: "b0",
		Selected: "b0",
		Style: "eButtonStyle.Custom",
	},
};

const nums = (s) => s.replace(/[{},]/g, " ").trim().split(/\s+/).map(Number);

/** One dump default as a tagged string the runtime decodes (engine-defaults.ts). */
function encodeValue(type, raw) {
	if (type.Category === "Enum") return `e${type.Name}.${raw}`;
	switch (type.Name) {
		case "bool":
			return raw === "true" ? "b1" : "b0";
		case "int":
		case "int64":
		case "float":
		case "double":
			return Number.isFinite(Number(raw)) ? `n${Number(raw)}` : undefined;
		case "string":
		case "ContentId":
		case "Content":
			return `s${raw}`;
		case "Color3":
			return `c${nums(raw).join(" ")}`;
		case "Vector2":
			return `v${nums(raw).join(" ")}`;
		case "Vector3":
			return `w${nums(raw).join(" ")}`;
		case "UDim":
			return `u${nums(raw).join(" ")}`;
		case "UDim2":
			return `U${nums(raw).join(" ")}`;
		case "Rect":
			return `r${nums(raw).join(" ")}`;
		case "NumberRange":
			return `R${nums(raw).join(" ")}`;
		case "NumberSequence":
			return `N${nums(raw).join(" ")}`;
		case "ColorSequence":
			return `C${nums(raw).join(" ")}`;
		default:
			// CFrame, Ray, BrickColor, Font, …: no UI code reads these defaults.
			return undefined;
	}
}

const table = {};
let count = 0;
for (const cls of dump.Classes) {
	const lineage = chain(cls.Name);
	if (!lineage.some((n) => ROOTS.has(n))) continue;
	if (lineage.some((n) => EXCLUDED_ROOTS.has(n))) continue;
	const own = { ...(ABSTRACT[cls.Name] ?? {}) };
	for (const m of cls.Members) {
		if (m.MemberType !== "Property") continue;
		if (EXCLUDED_PROPS.has(m.Name) || own[m.Name] !== undefined) continue;
		if ((m.Tags ?? []).some((t) => SKIP_TAGS.has(t))) continue;
		if (m.Security?.Read !== "None") continue;
		if (typeof m.Default !== "string" || m.Default.startsWith("__api_dump"))
			continue;
		const value = encodeValue(m.ValueType, m.Default);
		if (value !== undefined) own[m.Name] = value;
	}
	const keys = Object.keys(own).sort();
	if (keys.length === 0) continue;
	table[cls.Name] = Object.fromEntries(keys.map((k) => [k, own[k]]));
	count += keys.length;
}

const classes = Object.keys(table).sort();
writeFileSync(
	join(repo, "packages/runtime/src/engine-defaults.ts"),
	`// Generated by scripts/gen-engine-defaults.mjs from ${version}. Do not edit.

/**
 * Each UI class's own property defaults (not its superclasses'), tagged by type:
 * \`b\` bool (1/0), \`n\` number, \`s\` string, \`e\` Enum.Item, \`c\` Color3,
 * \`v\` Vector2, \`w\` Vector3, \`u\` UDim, \`U\` UDim2, \`r\` Rect,
 * \`R\` NumberRange, \`N\` NumberSequence (time value envelope …),
 * \`C\` ColorSequence (time r g b envelope …). Decoded by \`engineDefault\` in
 * instance.ts.
 */
export const ENGINE_DEFAULTS: Readonly<
	Record<string, Readonly<Record<string, string>>>
> = {
${classes
	.map(
		(c) =>
			`\t${c}: {\n${Object.entries(table[c])
				.map(([k, v]) => `\t\t${k}: ${JSON.stringify(v)},`)
				.join("\n")}\n\t},`,
	)
	.join("\n")}
};
`,
);

execFileSync(
	join(repo, "node_modules/.bin/biome"),
	["format", "--write", "packages/runtime/src/engine-defaults.ts"],
	{ cwd: repo, stdio: "ignore" },
);

console.log(`${version}: ${count} defaults across ${classes.length} classes`);
