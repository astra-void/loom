mod algorithms;
mod model;
mod resolve;
mod session;

pub use model::{
    ComputedRect, LayoutAxis, LayoutAxisConstraints, LayoutConstraints, LayoutSize, LayoutVector,
    MeasuredNodeSize, PreviewHostMetadata, PreviewLayoutAspectRatioConstraint,
    PreviewLayoutDebugNode, PreviewLayoutDebugPayload, PreviewLayoutDebugProvenance,
    PreviewLayoutFlexItem, PreviewLayoutGridLayout, PreviewLayoutListLayout,
    PreviewLayoutModifiers, PreviewLayoutNode, PreviewLayoutPaddingInsets, PreviewLayoutResult,
    PreviewLayoutSizeConstraint, PreviewLayoutSizeResolution, PreviewLayoutStyleHints,
    PreviewLayoutTextSizeConstraint, PreviewNodeLayout, RobloxNode, Viewport,
};
pub use session::LayoutSession;

use wasm_bindgen::prelude::*;

use crate::resolve::legacy_to_preview_nodes;
use crate::session::to_js_error;

#[wasm_bindgen(js_name = createLayoutSession)]
pub fn create_layout_session() -> LayoutSession {
    LayoutSession::new()
}

#[wasm_bindgen]
pub fn compute_layout(
    raw_tree: JsValue,
    viewport_width: f32,
    viewport_height: f32,
) -> Result<JsValue, JsValue> {
    let root: RobloxNode = serde_wasm_bindgen::from_value(raw_tree)
        .map_err(|error| to_js_error(format!("Failed to parse raw_tree: {error}")))?;

    let mut nodes = Vec::new();
    legacy_to_preview_nodes(&root, None, &mut nodes);

    let mut session = LayoutSession::new();
    session.apply_preview_nodes(nodes);
    session.set_viewport_internal(Viewport {
        height: viewport_height,
        width: viewport_width,
    });

    let result = session.compute_dirty_internal().map_err(to_js_error)?;
    serde_wasm_bindgen::to_value(&result.rects)
        .map_err(|error| to_js_error(format!("Failed to serialize computed rects: {error}")))
}

#[cfg(test)]
mod tests;
