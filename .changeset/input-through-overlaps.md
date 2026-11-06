---
"@loom-dev/renderer": patch
---

Input reaches what is under the pointer the way it does in Roblox, through overlapping objects. A press goes to every object under the pointer, topmost first, down to the first `GuiButton` or `TextBox`, which takes it: a transparent Frame on top, `Active` or not, and a ScrollingFrame no longer block the button beneath them, and a Frame under a button (even its own parent) no longer hears the press. `MouseEnter`, `MouseLeave` and `MouseMoved` reach every object under the pointer and follow it as it moves, not only when the topmost one changes. A TextBox covered by a listening Frame still takes focus when clicked. `UserInputService:GetMouseLocation()` also reads the press position during a press that came with no move before it. Iris's windows, whose content sits under an `Active` resize border, now click, type, focus and resize.
