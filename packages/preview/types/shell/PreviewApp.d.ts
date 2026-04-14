import type { PreviewEntryDescriptor, PreviewEntryPayload } from "@loom-dev/preview-engine";
import { type PreviewModule } from "../execution/shared";
type PreviewAppProps = {
    entries: PreviewEntryDescriptor[];
    entryPayloads?: Record<string, PreviewEntryPayload>;
    initialSelectedId?: string;
    loadEntry: (id: string) => Promise<LoadedPreviewEntry>;
    projectName: string;
};
type LoadedPreviewEntry = {
    module: PreviewModule;
    payload?: PreviewEntryPayload;
};
export declare function PreviewApp(props: PreviewAppProps): import("react/jsx-runtime").JSX.Element;
export {};
