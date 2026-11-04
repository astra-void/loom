--!strict
-- A plain Roblox LocalScript (StarterPlayerScripts, by the `rojo init`
-- layout): require the shared card, put it in PlayerGui, tick it once a second.
-- Nothing here knows about loom; @loom-dev/luau runs it in upstream Luau and
-- paints the instances through the same layout engine and renderer.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Card = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Card"))

local gui = Instance.new("ScreenGui")
gui.Name = "LuauDemo"
local ticks = Card.mount(gui, "luau adapter demo")
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

local count = 0
while true do
	task.wait(1)
	count += 1
	ticks.Text = `ticks: {count}`
end
