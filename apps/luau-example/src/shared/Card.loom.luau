--!strict
-- A gallery target: run as a LocalScript inside the target's ScreenGui, so
-- whatever it builds under `script.Parent` is the preview.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Card = require(ReplicatedStorage.Shared.Card)

Card.mount(script.Parent, "luau gallery target")
