mod model;
mod session;

pub use model::{
    PreviewGraphBoundaryHop, PreviewGraphImportEdge, PreviewGraphRecordSnapshot, PreviewGraphTrace,
    PreviewGraphTraversedProject,
};
pub use session::PreviewGraphSession;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = createPreviewGraphSession)]
pub fn create_preview_graph_session() -> PreviewGraphSession {
    PreviewGraphSession::new()
}

#[cfg(test)]
mod tests;
