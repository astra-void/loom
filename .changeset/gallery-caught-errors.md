---
"@loom-dev/preview": patch
---

The dev gallery no longer paints an "uncaught error" panel over a target that catches its own throw in an error boundary. React 18's development build reports every render throw to `window` before a boundary takes it; the shell now skips those reports. A throw that really escapes still shows the panel.
