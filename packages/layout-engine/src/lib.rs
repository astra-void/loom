use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use taffy::{prelude::NodeId, Style, TaffyTree};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct LayoutAxis {
    #[serde(alias = "Offset")]
    pub offset: f32,
    #[serde(alias = "Scale")]
    pub scale: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct LayoutSize {
    #[serde(alias = "X")]
    pub x: LayoutAxis,
    #[serde(alias = "Y")]
    pub y: LayoutAxis,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct LayoutVector {
    #[serde(alias = "X")]
    pub x: f32,
    #[serde(alias = "Y")]
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutAxisConstraints {
    #[serde(default)]
    pub max: Option<f32>,
    #[serde(default)]
    pub min: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutConstraints {
    #[serde(default)]
    pub height: Option<LayoutAxisConstraints>,
    #[serde(default)]
    pub width: Option<LayoutAxisConstraints>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewNodeLayout {
    #[serde(alias = "anchor_point")]
    pub anchor_point: LayoutVector,
    #[serde(default)]
    pub constraints: Option<LayoutConstraints>,
    pub position: LayoutSize,
    #[serde(default = "default_position_mode")]
    pub position_mode: String,
    #[serde(default)]
    pub size: Option<LayoutSize>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct MeasuredNodeSize {
    pub height: f32,
    pub width: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutNode {
    #[serde(default)]
    pub debug_label: Option<String>,
    pub id: String,
    #[serde(default)]
    pub intrinsic_size: Option<MeasuredNodeSize>,
    pub kind: String,
    #[serde(alias = "node_type")]
    pub node_type: String,
    #[serde(default, alias = "parent_id")]
    pub parent_id: Option<String>,
    pub layout: PreviewNodeLayout,
    #[serde(default)]
    pub style_hints: Option<PreviewLayoutStyleHints>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PreviewLayoutStyleHints {
    #[serde(default)]
    pub height: Option<String>,
    #[serde(default)]
    pub width: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct ComputedRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Viewport {
    pub height: f32,
    pub width: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutDebugProvenance {
    pub detail: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutDebugNode {
    pub children: Vec<PreviewLayoutDebugNode>,
    #[serde(default)]
    pub debug_label: Option<String>,
    pub id: String,
    #[serde(default)]
    pub intrinsic_size: Option<MeasuredNodeSize>,
    pub kind: String,
    pub layout_source: String,
    pub node_type: String,
    #[serde(default)]
    pub parent_constraints: Option<ComputedRect>,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub provenance: PreviewLayoutDebugProvenance,
    #[serde(default)]
    pub rect: Option<ComputedRect>,
    #[serde(default)]
    pub style_hints: Option<PreviewLayoutStyleHints>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutDebugPayload {
    pub dirty_node_ids: Vec<String>,
    pub roots: Vec<PreviewLayoutDebugNode>,
    pub viewport: Viewport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutResult {
    pub debug: PreviewLayoutDebugPayload,
    pub dirty_node_ids: Vec<String>,
    pub rects: HashMap<String, ComputedRect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobloxNode {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(alias = "nodeType", alias = "NodeType")]
    pub node_type: String,
    #[serde(alias = "Size")]
    pub size: LayoutSize,
    #[serde(alias = "Position")]
    pub position: LayoutSize,
    #[serde(alias = "anchorPoint", alias = "AnchorPoint")]
    pub anchor_point: LayoutVector,
    #[serde(default, alias = "Children")]
    pub children: Vec<RobloxNode>,
}

fn default_position_mode() -> String {
    "absolute".to_owned()
}

fn zero_axis() -> LayoutAxis {
    LayoutAxis {
        offset: 0.0,
        scale: 0.0,
    }
}

fn full_axis() -> LayoutAxis {
    LayoutAxis {
        offset: 0.0,
        scale: 1.0,
    }
}

fn full_size() -> LayoutSize {
    LayoutSize {
        x: full_axis(),
        y: full_axis(),
    }
}

fn zero_size() -> LayoutSize {
    LayoutSize {
        x: zero_axis(),
        y: zero_axis(),
    }
}

fn zero_vector() -> LayoutVector {
    LayoutVector { x: 0.0, y: 0.0 }
}

fn create_viewport_rect(viewport: Viewport) -> ComputedRect {
    ComputedRect {
        x: 0.0,
        y: 0.0,
        width: viewport.width,
        height: viewport.height,
    }
}

fn resolve_axis(axis: LayoutAxis, parent_axis_size: f32) -> f32 {
    parent_axis_size * axis.scale + axis.offset
}

fn clamp_axis(value: f32, constraints: Option<&LayoutAxisConstraints>) -> f32 {
    let mut next = value;

    if let Some(min) = constraints.and_then(|axis| axis.min) {
        next = next.max(min);
    }

    if let Some(max) = constraints.and_then(|axis| axis.max) {
        next = next.min(max);
    }

    next
}

fn create_measured_size_layout(measured_size: MeasuredNodeSize) -> LayoutSize {
    LayoutSize {
        x: LayoutAxis {
            offset: measured_size.width.max(0.0),
            scale: 0.0,
        },
        y: LayoutAxis {
            offset: measured_size.height.max(0.0),
            scale: 0.0,
        },
    }
}

fn normalize_root_node(node: &PreviewLayoutNode) -> PreviewLayoutNode {
    if node.node_type != "ScreenGui" || node.parent_id.is_some() {
        return node.clone();
    }

    let mut normalized = node.clone();
    normalized.kind = "root".to_owned();
    normalized.layout.anchor_point = zero_vector();
    normalized.layout.position = zero_size();
    normalized.layout.size = Some(full_size());
    normalized
}

fn compute_node_rect(node: &PreviewLayoutNode, parent_rect: &ComputedRect) -> (ComputedRect, &'static str) {
    if node.kind == "root" {
        return (
            ComputedRect {
                x: 0.0,
                y: 0.0,
                width: parent_rect.width,
                height: parent_rect.height,
            },
            "root-default",
        );
    }

    let (resolved_size, layout_source) = if let Some(size) = node.layout.size {
        (size, "explicit-size")
    } else if let Some(intrinsic_size) = node.intrinsic_size {
        (create_measured_size_layout(intrinsic_size), "intrinsic-size")
    } else {
        (zero_size(), "intrinsic-size")
    };

    let width = clamp_axis(
        resolve_axis(resolved_size.x, parent_rect.width),
        node.layout.constraints.as_ref().and_then(|constraints| constraints.width.as_ref()),
    );
    let height = clamp_axis(
        resolve_axis(resolved_size.y, parent_rect.height),
        node.layout.constraints.as_ref().and_then(|constraints| constraints.height.as_ref()),
    );

    (
        ComputedRect {
            x: parent_rect.x
                + resolve_axis(node.layout.position.x, parent_rect.width)
                - (node.layout.anchor_point.x * width),
            y: parent_rect.y
                + resolve_axis(node.layout.position.y, parent_rect.height)
                - (node.layout.anchor_point.y * height),
            width,
            height,
        },
        layout_source,
    )
}

fn legacy_to_preview_nodes(
    node: &RobloxNode,
    parent_id: Option<String>,
    output: &mut Vec<PreviewLayoutNode>,
) {
    let preview_node = normalize_root_node(&PreviewLayoutNode {
        debug_label: Some(node.node_type.clone()),
        id: node.id.clone(),
        intrinsic_size: None,
        kind: if parent_id.is_none() && node.node_type == "ScreenGui" {
            "root".to_owned()
        } else {
            "host".to_owned()
        },
        layout: PreviewNodeLayout {
            anchor_point: node.anchor_point,
            constraints: None,
            position: node.position,
            position_mode: default_position_mode(),
            size: Some(node.size),
        },
        node_type: node.node_type.clone(),
        parent_id: parent_id.clone(),
        style_hints: None,
    });
    output.push(preview_node);

    for child in &node.children {
        legacy_to_preview_nodes(child, Some(node.id.clone()), output);
    }
}

fn sort_ids(ids: &mut Vec<String>) {
    ids.sort();
    ids.dedup();
}

fn to_js_error(message: String) -> JsValue {
    JsValue::from_str(&message)
}

#[wasm_bindgen]
pub struct LayoutSession {
    dirty_node_ids: HashSet<String>,
    last_rects: HashMap<String, ComputedRect>,
    nodes: HashMap<String, PreviewLayoutNode>,
    pending_removed_ids: HashSet<String>,
    dirty_root_ids: HashSet<String>,
    viewport: Viewport,
}

impl LayoutSession {
    fn apply_preview_nodes(&mut self, nodes: Vec<PreviewLayoutNode>) {
        for node in nodes {
            if let Some(previous_node) = self.nodes.get(&node.id).cloned() {
                self.mark_dirty_from_node(&previous_node.id);
                if previous_node.parent_id != node.parent_id {
                    if let Some(previous_parent_id) = previous_node.parent_id {
                        self.mark_dirty_from_node(&previous_parent_id);
                    }
                }
            }

            let normalized = normalize_root_node(&node);
            self.nodes.insert(normalized.id.clone(), normalized.clone());
            self.mark_dirty_from_node(&normalized.id);
            self.dirty_node_ids.insert(normalized.id.clone());
        }
    }

    fn child_ids_for_parent(&self, parent_id: &str) -> Vec<String> {
        let mut child_ids = self
            .nodes
            .values()
            .filter(|node| node.parent_id.as_deref() == Some(parent_id))
            .map(|node| node.id.clone())
            .collect::<Vec<_>>();
        child_ids.sort();
        child_ids
    }

    fn collect_subtree_ids(&self, node_id: &str, visited: &mut HashSet<String>, output: &mut Vec<String>) {
        if visited.contains(node_id) {
            return;
        }

        visited.insert(node_id.to_owned());
        output.push(node_id.to_owned());

        for child_id in self.child_ids_for_parent(node_id) {
            self.collect_subtree_ids(&child_id, visited, output);
        }
    }

    fn compute_dirty_internal(&mut self) -> Result<PreviewLayoutResult, String> {
        self.build_taffy_participant_tree()?;

        if self.nodes.is_empty() {
            self.last_rects.clear();
            let mut dirty_node_ids = self.pending_removed_ids.iter().cloned().collect::<Vec<_>>();
            dirty_node_ids.extend(self.dirty_node_ids.iter().cloned());
            sort_ids(&mut dirty_node_ids);
            self.dirty_node_ids.clear();
            self.pending_removed_ids.clear();
            self.dirty_root_ids.clear();

            return Ok(PreviewLayoutResult {
                debug: PreviewLayoutDebugPayload {
                    dirty_node_ids: dirty_node_ids.clone(),
                    roots: Vec::new(),
                    viewport: self.viewport,
                },
                dirty_node_ids,
                rects: HashMap::new(),
            });
        }

        let dirty_root_ids = self.get_dirty_root_ids();
        let viewport_rect = create_viewport_rect(self.viewport);

        for removed_id in &self.pending_removed_ids {
            self.last_rects.remove(removed_id);
        }

        for root_id in &dirty_root_ids {
            let mut subtree_ids = Vec::new();
            self.collect_subtree_ids(root_id, &mut HashSet::new(), &mut subtree_ids);
            for subtree_id in subtree_ids {
                self.last_rects.remove(&subtree_id);
            }

            self.compute_subtree(root_id, &viewport_rect);
        }

        let mut dirty_node_ids = self.dirty_node_ids.iter().cloned().collect::<Vec<_>>();
        dirty_node_ids.extend(self.pending_removed_ids.iter().cloned());
        sort_ids(&mut dirty_node_ids);

        let mut roots = Vec::new();
        for root_id in self.root_ids() {
            if let Some(debug_node) = self.build_debug_tree(&root_id, Some(viewport_rect)) {
                roots.push(debug_node);
            }
        }

        self.dirty_node_ids.clear();
        self.dirty_root_ids.clear();
        self.pending_removed_ids.clear();

        Ok(PreviewLayoutResult {
            debug: PreviewLayoutDebugPayload {
                dirty_node_ids: dirty_node_ids.clone(),
                roots,
                viewport: self.viewport,
            },
            dirty_node_ids,
            rects: self.last_rects.clone(),
        })
    }

    fn compute_subtree(&mut self, node_id: &str, parent_rect: &ComputedRect) {
        let Some(node) = self.nodes.get(node_id).cloned() else {
            return;
        };

        let (rect, _) = compute_node_rect(&node, parent_rect);
        self.last_rects.insert(node.id.clone(), rect);

        for child_id in self.child_ids_for_parent(node_id) {
            self.compute_subtree(&child_id, &rect);
        }
    }

    fn build_debug_tree(
        &self,
        node_id: &str,
        parent_constraints: Option<ComputedRect>,
    ) -> Option<PreviewLayoutDebugNode> {
        let node = self.nodes.get(node_id)?;
        let rect = self.last_rects.get(node_id).copied();
        let children = self
            .child_ids_for_parent(node_id)
            .iter()
            .filter_map(|child_id| self.build_debug_tree(child_id, rect))
            .collect::<Vec<_>>();

        Some(PreviewLayoutDebugNode {
            children,
            debug_label: node.debug_label.clone(),
            id: node.id.clone(),
            intrinsic_size: node.intrinsic_size,
            kind: node.kind.clone(),
            layout_source: if node.kind == "root" {
                "root-default".to_owned()
            } else if node.layout.size.is_some() {
                "explicit-size".to_owned()
            } else {
                "intrinsic-size".to_owned()
            },
            node_type: node.node_type.clone(),
            parent_constraints,
            parent_id: node.parent_id.clone(),
            provenance: PreviewLayoutDebugProvenance {
                detail: "computed by layout-engine session".to_owned(),
                source: "wasm".to_owned(),
            },
            rect,
            style_hints: node.style_hints.clone(),
        })
    }

    fn build_taffy_participant_tree(&self) -> Result<(), String> {
        let mut taffy: TaffyTree<()> = TaffyTree::new();
        let mut taffy_nodes = HashMap::<String, NodeId>::new();

        for node in self.nodes.values() {
            let taffy_node = taffy
                .new_leaf(Style::default())
                .map_err(|error| format!("Failed to create Taffy node for {}: {error}", node.id))?;
            taffy_nodes.insert(node.id.clone(), taffy_node);
        }

        for node in self.nodes.values() {
            let Some(parent_node) = taffy_nodes.get(&node.id) else {
                continue;
            };

            let child_nodes = self
                .child_ids_for_parent(&node.id)
                .iter()
                .filter_map(|child_id| taffy_nodes.get(child_id).copied())
                .collect::<Vec<_>>();

            taffy
                .set_children(*parent_node, &child_nodes)
                .map_err(|error| format!("Failed to attach Taffy children for {}: {error}", node.id))?;
        }

        Ok(())
    }

    fn get_dirty_root_ids(&self) -> Vec<String> {
        let mut dirty_root_ids = if !self.dirty_root_ids.is_empty() {
            self.dirty_root_ids.iter().cloned().collect::<Vec<_>>()
        } else if self.last_rects.is_empty() {
            self.root_ids()
        } else {
            Vec::new()
        };

        sort_ids(&mut dirty_root_ids);
        dirty_root_ids
    }

    fn mark_dirty_from_node(&mut self, node_id: &str) {
        if let Some(root_id) = self.resolve_root_id(node_id) {
            self.dirty_root_ids.insert(root_id);
        }
    }

    fn remove_node_ids(&mut self, node_ids: Vec<String>) {
        for node_id in node_ids {
            self.mark_dirty_from_node(&node_id);
            let mut subtree_ids = Vec::new();
            self.collect_subtree_ids(&node_id, &mut HashSet::new(), &mut subtree_ids);

            for subtree_id in subtree_ids {
                self.nodes.remove(&subtree_id);
                self.last_rects.remove(&subtree_id);
                self.dirty_node_ids.insert(subtree_id.clone());
                self.pending_removed_ids.insert(subtree_id);
            }
        }
    }

    fn resolve_root_id(&self, node_id: &str) -> Option<String> {
        let mut cursor = Some(node_id.to_owned());
        let mut last_known = None;
        let mut visited = HashSet::new();

        while let Some(current) = cursor {
            if visited.contains(&current) {
                return last_known.or(Some(current));
            }

            visited.insert(current.clone());
            let node = self.nodes.get(&current)?;
            last_known = Some(node.id.clone());
            cursor = node
                .parent_id
                .as_ref()
                .filter(|parent_id| self.nodes.contains_key(*parent_id))
                .cloned();
        }

        last_known
    }

    fn root_ids(&self) -> Vec<String> {
        let mut root_ids = self
            .nodes
            .values()
            .filter(|node| {
                node.parent_id
                    .as_ref()
                    .map(|parent_id| !self.nodes.contains_key(parent_id))
                    .unwrap_or(true)
            })
            .map(|node| node.id.clone())
            .collect::<Vec<_>>();
        sort_ids(&mut root_ids);
        root_ids
    }

    fn set_viewport_internal(&mut self, viewport: Viewport) {
        self.viewport = viewport;
        for root_id in self.root_ids() {
            self.dirty_root_ids.insert(root_id);
        }
        for node_id in self.nodes.keys() {
            self.dirty_node_ids.insert(node_id.clone());
        }
    }
}

#[wasm_bindgen]
impl LayoutSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> LayoutSession {
        LayoutSession {
            dirty_node_ids: HashSet::new(),
            last_rects: HashMap::new(),
            nodes: HashMap::new(),
            pending_removed_ids: HashSet::new(),
            dirty_root_ids: HashSet::new(),
            viewport: Viewport {
                height: 0.0,
                width: 0.0,
            },
        }
    }

    #[wasm_bindgen(js_name = applyNodes)]
    pub fn apply_nodes(&mut self, raw_nodes: JsValue) -> Result<(), JsValue> {
        let nodes: Vec<PreviewLayoutNode> = serde_wasm_bindgen::from_value(raw_nodes)
            .map_err(|error| to_js_error(format!("Failed to parse layout nodes: {error}")))?;
        self.apply_preview_nodes(nodes);
        Ok(())
    }

    #[wasm_bindgen(js_name = computeDirty)]
    pub fn compute_dirty(&mut self) -> Result<JsValue, JsValue> {
        let result = self.compute_dirty_internal().map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&result)
            .map_err(|error| to_js_error(format!("Failed to serialize layout result: {error}")))
    }

    pub fn dispose(&mut self) {
        self.dirty_node_ids.clear();
        self.last_rects.clear();
        self.nodes.clear();
        self.pending_removed_ids.clear();
        self.dirty_root_ids.clear();
        self.viewport = Viewport {
            height: 0.0,
            width: 0.0,
        };
    }

    #[wasm_bindgen(js_name = removeNodes)]
    pub fn remove_nodes(&mut self, raw_node_ids: JsValue) -> Result<(), JsValue> {
        let node_ids: Vec<String> = serde_wasm_bindgen::from_value(raw_node_ids)
            .map_err(|error| to_js_error(format!("Failed to parse node ids: {error}")))?;
        self.remove_node_ids(node_ids);
        Ok(())
    }

    #[wasm_bindgen(js_name = setViewport)]
    pub fn set_viewport(&mut self, raw_viewport: JsValue) -> Result<(), JsValue> {
        let viewport: Viewport = serde_wasm_bindgen::from_value(raw_viewport)
            .map_err(|error| to_js_error(format!("Failed to parse viewport: {error}")))?;
        self.set_viewport_internal(viewport);
        Ok(())
    }
}

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
mod tests {
    use super::*;
    use serde_json::json;

    fn assert_close(actual: f32, expected: f32) {
        let delta = (actual - expected).abs();
        assert!(delta < 0.0001, "expected {expected}, got {actual}");
    }

    fn axis(scale: f32, offset: f32) -> LayoutAxis {
        LayoutAxis { scale, offset }
    }

    fn size(x_scale: f32, x_offset: f32, y_scale: f32, y_offset: f32) -> LayoutSize {
        LayoutSize {
            x: axis(x_scale, x_offset),
            y: axis(y_scale, y_offset),
        }
    }

    fn node(id: &str, parent_id: Option<&str>, kind: &str, node_type: &str) -> PreviewLayoutNode {
        PreviewLayoutNode {
            debug_label: Some(id.to_owned()),
            id: id.to_owned(),
            intrinsic_size: None,
            kind: kind.to_owned(),
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: zero_size(),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 100.0, 0.0, 40.0)),
            },
            node_type: node_type.to_owned(),
            parent_id: parent_id.map(ToOwned::to_owned),
            style_hints: None,
        }
    }

    #[test]
    fn computes_rooted_tree_layout_for_hosts() {
        let mut session = LayoutSession::new();
        session.apply_preview_nodes(vec![
            node("screen", None, "root", "ScreenGui"),
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: LayoutVector { x: 0.5, y: 0.5 },
                    constraints: None,
                    position: size(0.5, 0.0, 0.5, 0.0),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 420.0, 0.0, 40.0)),
                },
                ..node("label", Some("screen"), "host", "TextLabel")
            },
        ]);
        session.set_viewport_internal(Viewport {
            height: 600.0,
            width: 800.0,
        });

        let result = session.compute_dirty_internal().expect("layout should compute");

        let screen = result.rects.get("screen").expect("screen should exist");
        assert_close(screen.x, 0.0);
        assert_close(screen.y, 0.0);
        assert_close(screen.width, 800.0);
        assert_close(screen.height, 600.0);

        let label = result.rects.get("label").expect("label should exist");
        assert_close(label.x, 190.0);
        assert_close(label.y, 280.0);
        assert_close(label.width, 420.0);
        assert_close(label.height, 40.0);
    }

    #[test]
    fn uses_intrinsic_size_when_explicit_size_is_missing() {
        let mut session = LayoutSession::new();
        session.apply_preview_nodes(vec![
            node("screen", None, "root", "ScreenGui"),
            PreviewLayoutNode {
                intrinsic_size: Some(MeasuredNodeSize {
                    height: 24.0,
                    width: 88.0,
                }),
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: None,
                },
                ..node("label", Some("screen"), "host", "TextLabel")
            },
        ]);
        session.set_viewport_internal(Viewport {
            height: 480.0,
            width: 640.0,
        });

        let result = session.compute_dirty_internal().expect("layout should compute");

        let label = result.rects.get("label").expect("label should exist");
        assert_close(label.width, 88.0);
        assert_close(label.height, 24.0);
        assert_eq!(
            result
                .debug
                .roots
                .first()
                .and_then(|root| root.children.first())
                .map(|node| node.layout_source.as_str()),
            Some("intrinsic-size")
        );
    }

    #[test]
    fn marks_only_dirty_subtrees_after_incremental_update() {
        let mut session = LayoutSession::new();
        session.apply_preview_nodes(vec![
            node("screen", None, "root", "ScreenGui"),
            node("left", Some("screen"), "host", "Frame"),
            node("right", Some("screen"), "host", "Frame"),
        ]);
        session.set_viewport_internal(Viewport {
            height: 400.0,
            width: 400.0,
        });

        let _ = session.compute_dirty_internal().expect("initial layout should compute");

        session.apply_preview_nodes(vec![PreviewLayoutNode {
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: size(0.5, 0.0, 0.0, 0.0),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 120.0, 0.0, 40.0)),
            },
            ..node("right", Some("screen"), "host", "Frame")
        }]);

        let result = session
            .compute_dirty_internal()
            .expect("incremental layout should compute");

        assert!(result.dirty_node_ids.iter().any(|node_id| node_id == "right"));
        assert!(!result.dirty_node_ids.iter().any(|node_id| node_id == "left"));
    }

    #[test]
    fn legacy_tree_conversion_preserves_layout_shape() {
        let raw_tree: RobloxNode = serde_json::from_value(json!({
            "id": "screen",
            "node_type": "ScreenGui",
            "size": {
                "X": { "Scale": 1.0, "Offset": 0.0 },
                "Y": { "Scale": 1.0, "Offset": 0.0 }
            },
            "position": {
                "X": { "Scale": 0.0, "Offset": 0.0 },
                "Y": { "Scale": 0.0, "Offset": 0.0 }
            },
            "anchor_point": { "X": 0.0, "Y": 0.0 },
            "children": [{
                "id": "frame",
                "node_type": "Frame",
                "size": {
                    "X": { "Scale": 0.0, "Offset": 100.0 },
                    "Y": { "Scale": 0.0, "Offset": 50.0 }
                },
                "position": {
                    "X": { "Scale": 0.5, "Offset": 0.0 },
                    "Y": { "Scale": 0.5, "Offset": 0.0 }
                },
                "anchor_point": { "X": 0.5, "Y": 0.5 },
                "children": []
            }]
        }))
        .expect("legacy tree should deserialize");

        let mut preview_nodes = Vec::new();
        legacy_to_preview_nodes(&raw_tree, None, &mut preview_nodes);

        let mut session = LayoutSession::new();
        session.apply_preview_nodes(preview_nodes);
        session.set_viewport_internal(Viewport {
            height: 600.0,
            width: 800.0,
        });

        let result = session.compute_dirty_internal().expect("layout should compute");

        let frame = result.rects.get("frame").expect("frame should exist");
        assert_close(frame.x, 350.0);
        assert_close(frame.y, 275.0);
        assert_close(frame.width, 100.0);
        assert_close(frame.height, 50.0);
    }
}
