/**
 * `@loom-dev/luau/entry` — the client entry `@loom-dev/preview` gives a Luau
 * project's page: build the Rojo project the preview plugin serves, and start
 * the client. A real module rather than a generated one, so Vite's dependency
 * scan can follow it like any app entry.
 */
import { project } from "virtual:loom-luau-project";
import { runLuauProject } from "./mount.ts";

void runLuauProject(project);
