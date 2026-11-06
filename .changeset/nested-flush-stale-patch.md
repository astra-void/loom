---
"@loom-dev/react": patch
---

A component that sets state from an `AbsoluteSize` listener now keeps what that update painted. The listener runs during a layout flush, and with the adapter's synchronous root its state update commits and repaints right away. The flush that fired it then painted its own, older layout back over the new one, and nothing was left dirty to correct it. It also kept writing the older geometry to the instances it had not reached yet. A clean-ui `Table`, which sizes its columns from measured cells, stayed 0 wide on a cold page load because of this.
