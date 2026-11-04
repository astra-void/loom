--!strict
-- The react/vide example card, as a plain Roblox LocalScript: build the
-- instances, parent them into PlayerGui, then tick a label once a second.
-- Nothing here knows about loom; @loom-dev/luau runs it in upstream Luau and
-- paints the instances through the same layout engine and renderer.

local Players = game:GetService("Players")
local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")

local gui = Instance.new("ScreenGui")
gui.Name = "LuauDemo"

local card = Instance.new("Frame")
card.Name = "Card"
card.Size = UDim2.new(0, 320, 0, 120)
card.Position = UDim2.fromScale(0.5, 0.5)
card.AnchorPoint = Vector2.new(0.5, 0.5)
card.BackgroundColor3 = Color3.fromRGB(24, 27, 34)
card.Parent = gui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 12)
corner.Parent = card

local stroke = Instance.new("UIStroke")
stroke.Color = Color3.fromRGB(70, 78, 95)
stroke.Thickness = 1
stroke.Parent = card

local list = Instance.new("UIListLayout")
list.FillDirection = Enum.FillDirection.Vertical
list.HorizontalAlignment = Enum.HorizontalAlignment.Center
list.VerticalAlignment = Enum.VerticalAlignment.Center
list.SortOrder = Enum.SortOrder.LayoutOrder
list.Padding = UDim.new(0, 8)
list.Parent = card

local function label(name: string, order: number, text: string, color: Color3, size: number): TextLabel
	local l = Instance.new("TextLabel")
	l.Name = name
	l.AutomaticSize = Enum.AutomaticSize.XY
	l.BackgroundTransparency = 1
	l.LayoutOrder = order
	l.Text = text
	l.TextColor3 = color
	l.TextSize = size
	l.Font = Enum.Font.GothamBold
	l.Parent = card
	return l
end

label("Title", 1, "luau adapter demo", Color3.fromRGB(255, 255, 255), 20)
local ticks = label("Ticks", 2, "ticks: 0", Color3.fromRGB(130, 170, 255), 28)

gui.Parent = playerGui

local count = 0
while true do
	task.wait(1)
	count += 1
	ticks.Text = `ticks: {count}`
end
