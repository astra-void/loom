// @vitest-environment node
import { type LoomInstance, UDim2 } from "@loom-dev/runtime";
import { describe, expect, it, vi } from "vitest";
import { createRobloxBindings } from "./bindings.ts";
import { type LuauError, LuauVM, type ThreadResult } from "./vm.ts";

async function roblox(
	onError: (error: LuauError) => void = () => {},
): Promise<LuauVM> {
	const bindings = createRobloxBindings();
	const vm = await LuauVM.create({ classify: bindings.classify, onError });
	bindings.install(vm);
	return vm;
}

function done(result: ThreadResult): unknown[] {
	if (result.status === "error") throw result.error;
	if (result.status !== "done") throw new Error("thread yielded");
	return result.values;
}

/** Run `source` with a `log` global that collects what it is given. */
async function logged(source: string, onError?: (error: LuauError) => void) {
	const vm = await roblox(onError);
	const log: unknown[] = [];
	const result = vm.run(source, {
		globals: {
			log: (...values: unknown[]) => {
				log.push(values.length === 1 ? values[0] : values);
			},
		},
	});
	return { vm, log, result };
}

describe("datatypes", () => {
	it("constructs, reads and prints them the Roblox way", async () => {
		const vm = await roblox();
		const values = done(
			vm.run(`
				local size = UDim2.new(0, 320, 0.5, 10)
				local c = Color3.fromRGB(255, 128, 0)
				return typeof(size), size.X.Offset, size.Y.Scale, tostring(UDim.new(1, 2)), c:ToHex(), Vector2.zero.X
			`),
		);
		expect(values).toEqual(["UDim2", 320, 0.5, "1, 2", "ff8000", 0]);
	});

	it("hands the runtime's own objects to and from Luau", async () => {
		const vm = await roblox();
		const [size] = done(vm.run("return UDim2.fromOffset(10, 20)"));
		expect(size).toBeInstanceOf(UDim2);
		expect(size).toEqual(UDim2.fromOffset(10, 20));
	});

	it("spreads a multi-value method into Luau results", async () => {
		const vm = await roblox();
		const [h, s, v] = done(vm.run("return Color3.new(1, 0, 0):ToHSV()"));
		expect([h, s, v]).toEqual([0, 1, 1]);
	});

	it("does arithmetic and equality through metamethods", async () => {
		const vm = await roblox();
		const values = done(
			vm.run(`
				local a, b = Vector2.new(1, 2), Vector2.new(3, 4)
				local sum = a + b
				return sum.X, (b - a).Y, (a * 2).Y, (2 * a).X, (-a).X, UDim2.new(1, 2, 3, 4) == UDim2.new(1, 2, 3, 4)
			`),
		);
		expect(values).toEqual([4, 2, 4, 2, -1, true]);
	});

	it("keeps datatypes immutable and their libraries frozen", async () => {
		const vm = await roblox();
		const values = done(
			vm.run(`
				local v = Vector2.new(1, 2)
				return pcall(function() v.X = 5 end), pcall(function() UDim2.new = nil end), pcall(function() return v.toString end)
			`),
		);
		// Every call but the last in a return list is cut to its first value.
		expect(values).toEqual([
			false,
			false,
			false,
			"toString is not a valid member of Vector2",
		]);
	});
});

describe("Enum", () => {
	it("exposes enums and items with their reflection", async () => {
		const vm = await roblox();
		const values = done(
			vm.run(`
				local item = Enum.FillDirection.Vertical
				return typeof(item), item.Name, item.Value, tostring(item), item.EnumType == Enum.FillDirection,
					item:IsA("FillDirection"), typeof(Enum.FillDirection), #Enum.FillDirection:GetEnumItems(),
					Enum.FillDirection:FromName("Horizontal") == Enum.FillDirection.Horizontal
			`),
		);
		expect(values).toEqual([
			"EnumItem",
			"Vertical",
			1,
			"Enum.FillDirection.Vertical",
			true,
			true,
			"Enum",
			2,
			true,
		]);
	});

	it("errors on an item that does not exist", async () => {
		const vm = await roblox();
		expect(
			done(
				vm.run(
					"return pcall(function() return Enum.FillDirection.Diagonal end)",
				),
			),
		).toEqual([false, "Diagonal is not a valid EnumItem"]);
	});
});

describe("Instance", () => {
	it("builds a tree with properties, children and methods", async () => {
		const vm = await roblox();
		const [card] = done(
			vm.run(`
				local card = Instance.new("Frame")
				card.Name = "Card"
				card.Size = UDim2.fromOffset(320, 120)
				local title = Instance.new("TextLabel", card)
				title.Name = "Title"
				title.Text = "hi"
				return card
			`),
		);
		const frame = card as LoomInstance;
		expect(frame.Name).toBe("Card");
		expect(frame.Size).toEqual(UDim2.fromOffset(320, 120));
		expect(frame.FindFirstChild("Title")?.ClassName).toBe("TextLabel");
	});

	it("reads back what the script built", async () => {
		const vm = await roblox();
		const values = done(
			vm.run(`
				local card = Instance.new("Frame")
				local title = Instance.new("TextLabel", card)
				title.Name = "Title"
				return typeof(card), card.ClassName, card.Title == title, #card:GetChildren(),
					title:IsA("GuiObject"), card.Missing, tostring(card)
			`),
		);
		expect(values).toEqual([
			"Instance",
			"Frame",
			true,
			1,
			true,
			undefined,
			"Frame",
		]);
	});

	it("calls a method read with a dot, too", async () => {
		const vm = await roblox();
		expect(
			done(
				vm.run(
					`local f = Instance.new("Frame") local find = f.FindFirstChild return find(f, "x") == nil`,
				),
			),
		).toEqual([true]);
	});

	it("reaches the services through game", async () => {
		const vm = await roblox();
		const values = done(
			vm.run(`
				local players = game:GetService("Players")
				return typeof(players), players.LocalPlayer ~= nil, workspace == game:GetService("Workspace")
			`),
		);
		expect(values).toEqual(["Instance", true, true]);
	});
});

describe("signals", () => {
	it("connects a Luau handler, and disconnects it", async () => {
		const { log, result } = await logged(`
			local f = Instance.new("Frame")
			local connection = f:GetPropertyChangedSignal("Name"):Connect(function()
				log(f.Name)
			end)
			f.Name = "One"
			log(connection.Connected)
			connection:Disconnect()
			f.Name = "Two"
			log(connection.Connected, typeof(connection))
		`);
		done(result);
		expect(log).toEqual(["One", true, [false, "RBXScriptConnection"]]);
	});

	it("runs each handler in its own thread, so it may yield", async () => {
		const { log, result } = await logged(`
			local f = Instance.new("Frame")
			f.ChildAdded:Connect(function(child)
				task.wait()
				log(child.Name)
			end)
			local c = Instance.new("Frame")
			c.Name = "Late"
			c.Parent = f
			log("fired")
		`);
		done(result);
		expect(log).toEqual(["fired"]);
		await vi.waitFor(() => expect(log).toEqual(["fired", "Late"]));
	});

	it("yields in Signal:Wait until the signal fires", async () => {
		const { log, result } = await logged(`
			local f = Instance.new("Frame")
			task.delay(0.01, function()
				local child = Instance.new("Frame")
				child.Name = "Arrived"
				child.Parent = f
			end)
			local child = f.ChildAdded:Wait()
			log(child.Name)
		`);
		expect(result.status).toBe("yielded");
		expect(log).toEqual([]);
		await vi.waitFor(() => expect(log).toEqual(["Arrived"]));
	});
});

describe("yields", () => {
	it("WaitForChild yields until the child arrives", async () => {
		const { log, result } = await logged(`
			local parent = Instance.new("Frame")
			task.delay(0.01, function()
				local child = Instance.new("Frame")
				child.Name = "Arrives"
				child.Parent = parent
			end)
			log(parent:WaitForChild("Arrives").Name)
		`);
		expect(result.status).toBe("yielded");
		await vi.waitFor(() => expect(log).toEqual(["Arrives"]));
	});

	it("WaitForChild gives nil once its timeout runs out", async () => {
		const { log } = await logged(`
			local parent = Instance.new("Frame")
			log(parent:WaitForChild("Never", 0.01) == nil)
		`);
		await vi.waitFor(() => expect(log).toEqual([true]));
	});
});

describe("task", () => {
	it("orders spawn, defer and wait the Roblox way", async () => {
		const { log, result } = await logged(`
			task.defer(function() log("defer") end)
			task.spawn(function() log("spawn") end)
			log("main")
			local waited = task.wait(0.01)
			log(waited >= 0.01)
		`);
		expect(result.status).toBe("yielded");
		// spawn runs now, defer once the current resumption is over, wait last.
		await vi.waitFor(() =>
			expect(log).toEqual(["spawn", "main", "defer", true]),
		);
	});

	it("passes arguments through task.delay, and task.cancel stops a thread", async () => {
		const { log } = await logged(`
			task.delay(0.01, function(a, b) log(a + b) end, 2, 3)
			local stopped = task.spawn(function() task.wait(0.01) log("not cancelled") end)
			task.cancel(stopped)
		`);
		await vi.waitFor(() => expect(log).toEqual([5]));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(log).toEqual([5]);
	});

	it("reports an error inside task.spawn without stopping the script", async () => {
		const onError = vi.fn();
		const { log, result } = await logged(
			`
			task.spawn(function() error("inside") end)
			log("after")
		`,
			onError,
		);
		done(result);
		expect(log).toEqual(["after"]);
		expect(onError).toHaveBeenCalledOnce();
		expect((onError.mock.calls[0]?.[0] as LuauError).message).toMatch(/inside/);
	});
});

describe("globals", () => {
	it("prints through tostring, like the engine", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const vm = await roblox();
		done(
			vm.run(
				`print("size", UDim2.new(0, 1, 0, 2), Enum.SortOrder.Name, nil, 3)`,
			),
		);
		expect(spy).toHaveBeenCalledWith(
			"size {0, 1}, {0, 2} Enum.SortOrder.Name nil 3",
		);
		spy.mockRestore();
	});

	it("says require is not there yet", async () => {
		const vm = await roblox();
		expect(done(vm.run("return pcall(require, 'x')"))[1]).toMatch(
			/require is not supported/,
		);
	});
});
