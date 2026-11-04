--!strict
-- The react/vide example card as a ModuleScript: `Card.mount(parent, title)`
-- builds it under `parent` and returns the label that counts.

local Theme = require(script.Parent.Theme)

local Card = {}

local function label(parent: Instance, name: string, order: number, text: string, color: Color3, size: number): TextLabel
	local l = Instance.new("TextLabel")
	l.Name = name
	l.AutomaticSize = Enum.AutomaticSize.XY
	l.BackgroundTransparency = 1
	l.LayoutOrder = order
	l.Text = text
	l.TextColor3 = color
	l.TextSize = size
	l.Font = Theme.font
	l.Parent = parent
	return l
end

function Card.mount(parent: Instance, title: string): TextLabel
	local card = Instance.new("Frame")
	card.Name = "Card"
	card.Size = UDim2.new(0, 320, 0, 120)
	card.Position = UDim2.fromScale(0.5, 0.5)
	card.AnchorPoint = Vector2.new(0.5, 0.5)
	card.BackgroundColor3 = Theme.background

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = card

	local stroke = Instance.new("UIStroke")
	stroke.Color = Theme.stroke
	stroke.Thickness = 1
	stroke.Parent = card

	local list = Instance.new("UIListLayout")
	list.FillDirection = Enum.FillDirection.Vertical
	list.HorizontalAlignment = Enum.HorizontalAlignment.Center
	list.VerticalAlignment = Enum.VerticalAlignment.Center
	list.SortOrder = Enum.SortOrder.LayoutOrder
	list.Padding = UDim.new(0, 8)
	list.Parent = card

	label(card, "Title", 1, title, Theme.title, 20)
	local ticks = label(card, "Ticks", 2, "ticks: 0", Theme.accent, 28)
	card.Parent = parent
	return ticks
end

return Card
