// Luau client entry. Until the preview plugin loads `.client.luau` scripts on
// its own, this hands the script's source to @loom-dev/luau, which runs it as a
// LocalScript in a WASM Luau VM and paints what it builds.
import { mountLuau } from "@loom-dev/luau";
import source from "./Card.client.luau?raw";

void mountLuau(source, { name: "Card" });
