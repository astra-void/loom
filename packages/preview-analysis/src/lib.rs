mod model;
mod session;
mod workspace;

pub use model::{
    PreviewGraphBoundaryHop, PreviewGraphImportEdge, PreviewGraphRecordSnapshot, PreviewGraphTrace,
    PreviewGraphTraversedProject,
};
pub use session::PreviewGraphSession;
pub use workspace::{
    PreviewSourceTargetSnapshot, WorkspaceAnalysisSession, WorkspaceDiscoverySnapshot,
    WorkspaceFileSnapshot, WorkspaceImportResolution, WorkspaceResolutionDiagnostic,
};

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = createPreviewGraphSession)]
pub fn create_preview_graph_session() -> PreviewGraphSession {
    PreviewGraphSession::new()
}

#[wasm_bindgen(js_name = createWorkspaceDiscoverySession)]
pub fn create_workspace_discovery_session(
    project_name: String,
    protocol_version: u32,
    resolve_import: js_sys::Function,
) -> WorkspaceAnalysisSession {
    WorkspaceAnalysisSession::new(project_name, protocol_version, resolve_import)
}

#[cfg(test)]
mod tests;
