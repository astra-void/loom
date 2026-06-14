--[[
	Loom parity — Roblox geometry/visual dump plugin.

	Walks a GuiObject subtree and POSTs a ParitySnapshot (the same JSON shape the
	Loom side emits) to the local parity runner, so `@loom-dev/parity` can diff
	real Roblox against Loom's preview.

	Install (drop-in local plugin):
	  - macOS:   ~/Documents/Roblox/Plugins/LoomParityDump.lua
	  - Windows: %LOCALAPPDATA%/Roblox/Plugins/LoomParityDump.lua
	  (Studio also accepts a Script right-clicked -> "Save as Local Plugin".)

	Usage:
	  1. Run the runner:  pnpm parity:serve   (listens on http://localhost:7878)
	  2. Enable Studio HTTP: Game Settings > Security > Allow HTTP Requests.
	  3. Select the ScreenGui / GuiObject you want to compare, then click
	     "Dump GUI" on the "Loom Parity" toolbar.

	The capture reflects the CURRENT on-screen layout, so dump at the same
	viewport you render Loom at (the snapshot includes the viewport; the runner
	warns on a mismatch).
]]

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local StarterGui = game:GetService("StarterGui")
local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local ENDPOINT = "http://localhost:7878/dump"

local toolbar = plugin:CreateToolbar("Loom Parity")
local button = toolbar:CreateButton(
	"Dump GUI",
	"Dump the selected GUI's geometry + visuals to the Loom parity runner",
	"rbxasset://textures/ui/GuiImagePlaceholder.png"
)

local function color3ToTable(color)
	return { r = color.R, g = color.G, b = color.B }
end

local function readVisual(instance)
	local visual = {}

	if instance:IsA("GuiObject") then
		visual.backgroundColor3 = color3ToTable(instance.BackgroundColor3)
		visual.backgroundTransparency = instance.BackgroundTransparency
		visual.rotation = instance.Rotation
		visual.visible = instance.Visible
	end

	if instance:IsA("TextLabel") or instance:IsA("TextButton") or instance:IsA("TextBox") then
		visual.text = instance.Text
		visual.textColor3 = color3ToTable(instance.TextColor3)
		visual.textTransparency = instance.TextTransparency
		visual.textSize = instance.TextSize
	end

	if instance:IsA("ImageLabel") or instance:IsA("ImageButton") then
		visual.imageColor3 = color3ToTable(instance.ImageColor3)
		visual.imageTransparency = instance.ImageTransparency
	end

	return visual
end

local function serialize(instance)
	local node = {
		name = instance.Name,
		className = instance.ClassName,
		absolutePosition = {
			x = instance.AbsolutePosition.X,
			y = instance.AbsolutePosition.Y,
		},
		absoluteSize = {
			x = instance.AbsoluteSize.X,
			y = instance.AbsoluteSize.Y,
		},
		zIndex = instance.ZIndex,
		visual = readVisual(instance),
		children = {},
	}

	for _, child in ipairs(instance:GetChildren()) do
		if child:IsA("GuiObject") then
			table.insert(node.children, serialize(child))
		end
	end

	return node
end

-- Resolve the GuiObject roots to dump: the current Selection if it contains
-- GuiObjects, otherwise every top-level GuiObject under StarterGui/PlayerGui.
local function resolveRoots()
	local roots = {}

	for _, instance in ipairs(Selection:Get()) do
		if instance:IsA("GuiObject") then
			table.insert(roots, instance)
		end
	end

	if #roots == 0 then
		local containers = { StarterGui }
		local localPlayer = Players.LocalPlayer
		if localPlayer then
			local playerGui = localPlayer:FindFirstChildOfClass("PlayerGui")
			if playerGui then
				table.insert(containers, playerGui)
			end
		end

		for _, container in ipairs(containers) do
			for _, collector in ipairs(container:GetChildren()) do
				if collector:IsA("LayerCollector") then
					for _, child in ipairs(collector:GetChildren()) do
						if child:IsA("GuiObject") then
							table.insert(roots, child)
						end
					end
				end
			end
		end
	end

	return roots
end

local function dump()
	local roots = resolveRoots()
	if #roots == 0 then
		warn("[Loom parity] Select a GuiObject (or a ScreenGui with GuiObject children) to dump.")
		return
	end

	local camera = Workspace.CurrentCamera
	local viewport = camera and camera.ViewportSize or Vector2.new(0, 0)

	local serializedRoots = {}
	for _, root in ipairs(roots) do
		table.insert(serializedRoots, serialize(root))
	end

	local payload = {
		source = "roblox",
		scene = roots[1].Name,
		viewport = { x = viewport.X, y = viewport.Y },
		capturedAt = DateTime.now():ToIsoDate(),
		roots = serializedRoots,
	}

	local ok, err = pcall(function()
		return HttpService:PostAsync(
			ENDPOINT,
			HttpService:JSONEncode(payload),
			Enum.HttpContentType.ApplicationJson,
			false
		)
	end)

	if ok then
		print(string.format(
			"[Loom parity] Dumped '%s' (%d root(s), viewport %dx%d) -> %s",
			payload.scene,
			#serializedRoots,
			viewport.X,
			viewport.Y,
			ENDPOINT
		))
	else
		warn(
			"[Loom parity] POST failed: "
				.. tostring(err)
				.. "\n  - Start the runner:  pnpm parity:serve"
				.. "\n  - Enable HTTP:       Game Settings > Security > Allow HTTP Requests"
		)
	end
end

button.Click:Connect(dump)
