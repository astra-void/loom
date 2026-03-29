use std::collections::{HashMap, HashSet};

use serde_wasm_bindgen;
use wasm_bindgen::prelude::*;

use crate::algorithms::{compute_grid_layout, compute_list_layout, ChildPlacement};
use crate::model::{
    ComputedRect, PreviewLayoutDebugNode, PreviewLayoutDebugPayload, PreviewLayoutDebugProvenance,
    PreviewLayoutNode, PreviewLayoutResult, Viewport,
};
use crate::resolve::{
    compare_nodes_for_parent, compare_source_order, compute_absolute_rect, create_viewport_rect,
    normalize_root_node, resolve_content_rect, resolve_host_policy, resolve_layout_source,
    resolve_padding_inset, resolve_size_resolution, sort_ids,
};

pub(crate) fn to_js_error(message: String) -> JsValue {
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
    pub(crate) fn apply_preview_nodes(&mut self, nodes: Vec<PreviewLayoutNode>) {
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

    fn sort_node_ids_by_source_order(&self, node_ids: &mut [String]) {
        node_ids.sort_by(|left_id, right_id| {
            let left_node = self.nodes.get(left_id);
            let right_node = self.nodes.get(right_id);

            match (left_node, right_node) {
                (Some(left), Some(right)) => compare_source_order(left, right),
                _ => left_id.cmp(right_id),
            }
        });
    }

    fn child_ids_for_parent(&self, parent_id: &str) -> Vec<String> {
        let mut child_ids = self
            .nodes
            .values()
            .filter(|node| node.parent_id.as_deref() == Some(parent_id))
            .map(|node| node.id.clone())
            .collect::<Vec<_>>();
        self.sort_node_ids_by_source_order(&mut child_ids);
        child_ids
    }

    fn visible_child_ids_for_parent(&self, parent_id: &str) -> Vec<String> {
        self.child_ids_for_parent(parent_id)
            .into_iter()
            .filter(|child_id| self.nodes.get(child_id).is_some_and(|node| node.visible))
            .collect::<Vec<_>>()
    }

    fn child_nodes_for_layout_parent(
        &self,
        parent_node: &PreviewLayoutNode,
    ) -> Vec<PreviewLayoutNode> {
        let mut child_nodes = self
            .visible_child_ids_for_parent(&parent_node.id)
            .into_iter()
            .filter_map(|child_id| self.nodes.get(&child_id).cloned())
            .collect::<Vec<_>>();
        child_nodes.sort_by(|left, right| compare_nodes_for_parent(parent_node, left, right));
        child_nodes
    }

    fn resolve_automatic_content_size(
        &self,
        node: &PreviewLayoutNode,
        current_rect: &ComputedRect,
        content_rect: &ComputedRect,
        child_ids: &[String],
    ) -> Option<ComputedRect> {
        let automatic_size = node.layout.automatic_size.as_deref().unwrap_or("none");
        if automatic_size == "none" || child_ids.is_empty() {
            return None;
        }

        let mut min_x = f32::INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut max_y = f32::NEG_INFINITY;
        let mut found = false;

        for child_id in child_ids {
            let Some(child_rect) = self.last_rects.get(child_id) else {
                continue;
            };

            found = true;
            min_x = min_x.min(child_rect.x - content_rect.x);
            min_y = min_y.min(child_rect.y - content_rect.y);
            max_x = max_x.max(child_rect.x + child_rect.width - content_rect.x);
            max_y = max_y.max(child_rect.y + child_rect.height - content_rect.y);
        }

        if !found {
            return None;
        }

        let padding = node
            .layout_modifiers
            .as_ref()
            .and_then(|modifiers| modifiers.padding.as_ref());
        let padding_left = padding
            .map(|insets| resolve_padding_inset(Some(&insets.left), current_rect.width))
            .unwrap_or(0.0);
        let padding_right = padding
            .map(|insets| resolve_padding_inset(Some(&insets.right), current_rect.width))
            .unwrap_or(0.0);
        let padding_top = padding
            .map(|insets| resolve_padding_inset(Some(&insets.top), current_rect.height))
            .unwrap_or(0.0);
        let padding_bottom = padding
            .map(|insets| resolve_padding_inset(Some(&insets.bottom), current_rect.height))
            .unwrap_or(0.0);

        let content_width = (max_x - min_x).max(0.0);
        let content_height = (max_y - min_y).max(0.0);
        let mut width = current_rect.width;
        let mut height = current_rect.height;

        if automatic_size == "x" || automatic_size == "xy" {
            width = content_width + padding_left + padding_right;
        }

        if automatic_size == "y" || automatic_size == "xy" {
            height = content_height + padding_top + padding_bottom;
        }

        if (width - current_rect.width).abs() < f32::EPSILON
            && (height - current_rect.height).abs() < f32::EPSILON
        {
            return None;
        }

        Some(ComputedRect {
            x: current_rect.x,
            y: current_rect.y,
            width,
            height,
        })
    }

    fn collect_subtree_ids(
        &self,
        node_id: &str,
        visited: &mut HashSet<String>,
        output: &mut Vec<String>,
    ) {
        if visited.contains(node_id) {
            return;
        }

        visited.insert(node_id.to_owned());
        output.push(node_id.to_owned());

        for child_id in self.child_ids_for_parent(node_id) {
            self.collect_subtree_ids(&child_id, visited, output);
        }
    }

    fn apply_child_placements(&mut self, placements: Vec<ChildPlacement>) {
        for placement in placements {
            self.compute_subtree_from_rect(&placement.node_id, placement.rect);
        }
    }

    fn compute_subtree_from_rect(&mut self, node_id: &str, rect: ComputedRect) {
        let Some(node) = self.nodes.get(node_id).cloned() else {
            return;
        };

        let mut current_rect = rect;

        for _ in 0..2 {
            self.last_rects.insert(node.id.clone(), current_rect);

            if !node.visible {
                return;
            }

            let child_ids = self.visible_child_ids_for_parent(&node.id);
            if child_ids.is_empty() {
                break;
            }

            let content_rect = resolve_content_rect(current_rect, &node);

            if node
                .layout_modifiers
                .as_ref()
                .and_then(|modifiers| modifiers.grid.as_ref())
                .is_some()
            {
                self.apply_child_placements(compute_grid_layout(
                    &node,
                    content_rect,
                    self.child_nodes_for_layout_parent(&node),
                ));
            } else if node
                .layout_modifiers
                .as_ref()
                .and_then(|modifiers| modifiers.list.as_ref())
                .is_some()
            {
                self.apply_child_placements(compute_list_layout(
                    &node,
                    content_rect,
                    self.child_nodes_for_layout_parent(&node),
                ));
            } else {
                for child_id in child_ids {
                    self.compute_subtree(&child_id, &content_rect);
                }
            }

            let Some(next_rect) = self.resolve_automatic_content_size(
                &node,
                &current_rect,
                &content_rect,
                &self.visible_child_ids_for_parent(&node.id),
            ) else {
                break;
            };

            if (next_rect.width - current_rect.width).abs() < f32::EPSILON
                && (next_rect.height - current_rect.height).abs() < f32::EPSILON
            {
                break;
            }

            current_rect.width = next_rect.width;
            current_rect.height = next_rect.height;
        }

        self.last_rects.insert(node.id.clone(), current_rect);
    }

    pub(crate) fn compute_dirty_internal(&mut self) -> Result<PreviewLayoutResult, String> {
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

        self.compute_subtree_from_rect(node_id, compute_absolute_rect(&node, parent_rect));
    }

    fn build_debug_tree(
        &self,
        node_id: &str,
        parent_constraints: Option<ComputedRect>,
    ) -> Option<PreviewLayoutDebugNode> {
        let node = self.nodes.get(node_id)?;
        let rect = self.last_rects.get(node_id).copied();
        let host_policy = resolve_host_policy(node);
        let size_resolution = resolve_size_resolution(node);
        let children = self
            .visible_child_ids_for_parent(node_id)
            .iter()
            .filter_map(|child_id| self.build_debug_tree(child_id, rect))
            .collect::<Vec<_>>();

        Some(PreviewLayoutDebugNode {
            children,
            debug_label: node.debug_label.clone(),
            host_policy,
            id: node.id.clone(),
            intrinsic_size: node.intrinsic_size,
            kind: node.kind.clone(),
            layout_source: resolve_layout_source(node).to_owned(),
            node_type: node.node_type.clone(),
            parent_constraints,
            parent_id: node.parent_id.clone(),
            provenance: PreviewLayoutDebugProvenance {
                detail: "computed by layout-engine session".to_owned(),
                source: "wasm".to_owned(),
            },
            rect,
            size_resolution,
            style_hints: node.style_hints.clone(),
        })
    }

    fn get_dirty_root_ids(&self) -> Vec<String> {
        let mut dirty_root_ids = if !self.dirty_root_ids.is_empty() {
            self.dirty_root_ids
                .iter()
                .filter_map(|node_id| self.resolve_root_id(node_id))
                .collect::<Vec<_>>()
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

    pub(crate) fn remove_node_ids(&mut self, node_ids: Vec<String>) {
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
        self.sort_node_ids_by_source_order(&mut root_ids);
        root_ids
    }

    pub(crate) fn set_viewport_internal(&mut self, viewport: Viewport) {
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
