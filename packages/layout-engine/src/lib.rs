use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
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
pub struct PreviewHostMetadata {
    #[serde(default)]
    pub degraded: bool,
    #[serde(default)]
    pub full_size_default: bool,
    #[serde(default = "default_placeholder_behavior")]
    pub placeholder_behavior: String,
}

impl Default for PreviewHostMetadata {
    fn default() -> Self {
        Self {
            degraded: false,
            full_size_default: false,
            placeholder_behavior: default_placeholder_behavior(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct PreviewLayoutPaddingInsets {
    #[serde(default = "zero_axis")]
    pub bottom: LayoutAxis,
    #[serde(default = "zero_axis")]
    pub left: LayoutAxis,
    #[serde(default = "zero_axis")]
    pub right: LayoutAxis,
    #[serde(default = "zero_axis")]
    pub top: LayoutAxis,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutListLayout {
    #[serde(default = "default_vertical_fill_direction")]
    pub fill_direction: String,
    #[serde(default = "default_left_alignment")]
    pub horizontal_alignment: String,
    #[serde(default)]
    pub horizontal_flex: Option<String>,
    #[serde(default)]
    pub item_line_alignment: Option<String>,
    #[serde(default = "zero_axis")]
    pub padding: LayoutAxis,
    #[serde(default = "default_sort_order")]
    pub sort_order: String,
    #[serde(default = "default_top_alignment")]
    pub vertical_alignment: String,
    #[serde(default)]
    pub vertical_flex: Option<String>,
    #[serde(default)]
    pub wraps: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutGridLayout {
    #[serde(default = "zero_size")]
    pub cell_padding: LayoutSize,
    #[serde(default = "zero_size")]
    pub cell_size: LayoutSize,
    #[serde(default = "default_vertical_fill_direction")]
    pub fill_direction: String,
    #[serde(default)]
    pub fill_direction_max_cells: u32,
    #[serde(default = "default_left_alignment")]
    pub horizontal_alignment: String,
    #[serde(default = "default_sort_order")]
    pub sort_order: String,
    #[serde(default = "default_top_left_corner")]
    pub start_corner: String,
    #[serde(default = "default_top_alignment")]
    pub vertical_alignment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutSizeConstraint {
    #[serde(default)]
    pub max_size: Option<LayoutVector>,
    #[serde(default)]
    pub min_size: Option<LayoutVector>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutTextSizeConstraint {
    #[serde(default)]
    pub max_text_size: Option<u32>,
    #[serde(default)]
    pub min_text_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutAspectRatioConstraint {
    pub aspect_ratio: f32,
    #[serde(default = "default_dominant_axis")]
    pub dominant_axis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutFlexItem {
    #[serde(default)]
    pub flex_mode: Option<String>,
    #[serde(default)]
    pub grow_ratio: Option<f32>,
    #[serde(default)]
    pub item_line_alignment: Option<String>,
    #[serde(default)]
    pub shrink_ratio: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutModifiers {
    #[serde(default)]
    pub aspect_ratio_constraint: Option<PreviewLayoutAspectRatioConstraint>,
    #[serde(default)]
    pub flex_item: Option<PreviewLayoutFlexItem>,
    #[serde(default)]
    pub grid: Option<PreviewLayoutGridLayout>,
    #[serde(default)]
    pub list: Option<PreviewLayoutListLayout>,
    #[serde(default)]
    pub padding: Option<PreviewLayoutPaddingInsets>,
    #[serde(default)]
    pub size_constraint: Option<PreviewLayoutSizeConstraint>,
    #[serde(default)]
    pub text_size_constraint: Option<PreviewLayoutTextSizeConstraint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutSizeResolution {
    pub had_explicit_size: bool,
    pub intrinsic_size_available: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLayoutNode {
    #[serde(default)]
    pub debug_label: Option<String>,
    #[serde(default)]
    pub host_metadata: Option<PreviewHostMetadata>,
    pub id: String,
    #[serde(default)]
    pub intrinsic_size: Option<MeasuredNodeSize>,
    pub kind: String,
    #[serde(default)]
    pub layout_modifiers: Option<PreviewLayoutModifiers>,
    #[serde(default)]
    pub layout_order: Option<i32>,
    pub layout: PreviewNodeLayout,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(alias = "node_type")]
    pub node_type: String,
    #[serde(default, alias = "parent_id")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub source_order: Option<i32>,
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
    pub host_policy: PreviewHostMetadata,
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
    pub size_resolution: PreviewLayoutSizeResolution,
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

#[derive(Debug, Clone, Copy)]
enum DominantAxisHint {
    Height,
    Width,
}

#[derive(Debug, Clone, Copy, Default)]
struct NodeDimensionOverrides {
    dominant_axis: Option<DominantAxisHint>,
    height: Option<f32>,
    width: Option<f32>,
}

#[derive(Debug, Clone, Copy)]
struct ResolvedNodeSize {
    layout_source: &'static str,
    resolved_size: LayoutSize,
    size_resolution_reason: &'static str,
}

#[derive(Debug, Clone)]
struct ListLayoutItem {
    child_node: PreviewLayoutNode,
    cross: f32,
    flex_item: Option<PreviewLayoutFlexItem>,
    main: f32,
}

fn default_position_mode() -> String {
    "absolute".to_owned()
}

fn default_placeholder_behavior() -> String {
    "none".to_owned()
}

fn default_vertical_fill_direction() -> String {
    "vertical".to_owned()
}

fn default_left_alignment() -> String {
    "left".to_owned()
}

fn default_top_alignment() -> String {
    "top".to_owned()
}

fn default_sort_order() -> String {
    "source".to_owned()
}

fn default_top_left_corner() -> String {
    "top-left".to_owned()
}

fn default_dominant_axis() -> String {
    "auto".to_owned()
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

fn clamp_value(value: f32, min: Option<f32>, max: Option<f32>) -> f32 {
    let mut next = value;

    if let Some(minimum) = min {
        next = next.max(minimum);
    }

    if let Some(maximum) = max {
        next = next.min(maximum);
    }

    next
}

fn clamp_axis(value: f32, constraints: Option<&LayoutAxisConstraints>) -> f32 {
    clamp_value(
        value,
        constraints.and_then(|axis| axis.min),
        constraints.and_then(|axis| axis.max),
    )
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

fn default_host_policy_for_node_type(node_type: &str) -> PreviewHostMetadata {
    match node_type {
        "Frame" => PreviewHostMetadata {
            degraded: false,
            full_size_default: true,
            placeholder_behavior: default_placeholder_behavior(),
        },
        "ScreenGui" => PreviewHostMetadata {
            degraded: false,
            full_size_default: true,
            placeholder_behavior: default_placeholder_behavior(),
        },
        "SurfaceGui" | "BillboardGui" => PreviewHostMetadata {
            degraded: true,
            full_size_default: true,
            placeholder_behavior: "container".to_owned(),
        },
        "CanvasGroup" => PreviewHostMetadata {
            degraded: false,
            full_size_default: true,
            placeholder_behavior: default_placeholder_behavior(),
        },
        "ViewportFrame" | "VideoFrame" => PreviewHostMetadata {
            degraded: true,
            full_size_default: true,
            placeholder_behavior: "opaque".to_owned(),
        },
        _ => PreviewHostMetadata::default(),
    }
}

fn resolve_host_policy(node: &PreviewLayoutNode) -> PreviewHostMetadata {
    node.host_metadata
        .clone()
        .unwrap_or_else(|| default_host_policy_for_node_type(&node.node_type))
}

fn resolve_node_size(node: &PreviewLayoutNode) -> ResolvedNodeSize {
    if node.kind == "root" {
        return ResolvedNodeSize {
            layout_source: "root-default",
            resolved_size: full_size(),
            size_resolution_reason: "root-default",
        };
    }

    if let Some(size) = node.layout.size {
        return ResolvedNodeSize {
            layout_source: "explicit-size",
            resolved_size: size,
            size_resolution_reason: "explicit-size",
        };
    }

    if node
        .host_metadata
        .as_ref()
        .is_some_and(|metadata| metadata.full_size_default)
    {
        return ResolvedNodeSize {
            layout_source: "full-size-default",
            resolved_size: full_size(),
            size_resolution_reason: "full-size-default",
        };
    }

    if let Some(intrinsic_size) = node.intrinsic_size {
        return ResolvedNodeSize {
            layout_source: "intrinsic-size",
            resolved_size: create_measured_size_layout(intrinsic_size),
            size_resolution_reason: "intrinsic-measurement",
        };
    }

    ResolvedNodeSize {
        layout_source: "intrinsic-size",
        resolved_size: zero_size(),
        size_resolution_reason: "intrinsic-empty",
    }
}

fn resolve_size_resolution(node: &PreviewLayoutNode) -> PreviewLayoutSizeResolution {
    if node.kind == "root" {
        return PreviewLayoutSizeResolution {
            had_explicit_size: false,
            intrinsic_size_available: false,
            reason: "root-default".to_owned(),
        };
    }

    let resolved = resolve_node_size(node);

    PreviewLayoutSizeResolution {
        had_explicit_size: node.layout.size.is_some(),
        intrinsic_size_available: node.intrinsic_size.is_some(),
        reason: resolved.size_resolution_reason.to_owned(),
    }
}

fn resolve_layout_source(node: &PreviewLayoutNode) -> &'static str {
    resolve_node_size(node).layout_source
}

fn resolve_padding_inset(value: Option<&LayoutAxis>, reference_size: f32) -> f32 {
    let Some(axis) = value else {
        return 0.0;
    };

    (reference_size * axis.scale + axis.offset).max(0.0)
}

fn resolve_content_rect(rect: ComputedRect, node: &PreviewLayoutNode) -> ComputedRect {
    let Some(padding) = node
        .layout_modifiers
        .as_ref()
        .and_then(|modifiers| modifiers.padding.as_ref())
    else {
        return rect;
    };

    let left = resolve_padding_inset(Some(&padding.left), rect.width);
    let right = resolve_padding_inset(Some(&padding.right), rect.width);
    let top = resolve_padding_inset(Some(&padding.top), rect.height);
    let bottom = resolve_padding_inset(Some(&padding.bottom), rect.height);

    ComputedRect {
        x: rect.x + left,
        y: rect.y + top,
        width: (rect.width - left - right).max(0.0),
        height: (rect.height - top - bottom).max(0.0),
    }
}

fn resolve_node_name<'a>(node: &'a PreviewLayoutNode) -> &'a str {
    node.name
        .as_deref()
        .or(node.debug_label.as_deref())
        .unwrap_or(node.id.as_str())
}

fn compare_source_order(left: &PreviewLayoutNode, right: &PreviewLayoutNode) -> Ordering {
    let left_order = left.source_order.unwrap_or(i32::MAX);
    let right_order = right.source_order.unwrap_or(i32::MAX);

    left_order
        .cmp(&right_order)
        .then_with(|| left.id.cmp(&right.id))
}

fn compare_nodes_for_parent(
    parent_node: &PreviewLayoutNode,
    left: &PreviewLayoutNode,
    right: &PreviewLayoutNode,
) -> Ordering {
    let sort_order = parent_node
        .layout_modifiers
        .as_ref()
        .and_then(|modifiers| {
            modifiers
                .list
                .as_ref()
                .map(|list| list.sort_order.as_str())
                .or_else(|| modifiers.grid.as_ref().map(|grid| grid.sort_order.as_str()))
        })
        .unwrap_or("source");

    match sort_order {
        "layout-order" => left
            .layout_order
            .unwrap_or(0)
            .cmp(&right.layout_order.unwrap_or(0))
            .then_with(|| compare_source_order(left, right)),
        "name" => resolve_node_name(left)
            .cmp(resolve_node_name(right))
            .then_with(|| compare_source_order(left, right)),
        _ => compare_source_order(left, right),
    }
}

fn resolve_base_node_size(node: &PreviewLayoutNode, parent_rect: &ComputedRect) -> (f32, f32) {
    let resolved = resolve_node_size(node);
    (
        resolve_axis(resolved.resolved_size.x, parent_rect.width),
        resolve_axis(resolved.resolved_size.y, parent_rect.height),
    )
}

fn apply_node_dimension_constraints(
    node: &PreviewLayoutNode,
    width: f32,
    height: f32,
) -> (f32, f32) {
    let mut next_width = clamp_axis(
        width,
        node.layout
            .constraints
            .as_ref()
            .and_then(|constraints| constraints.width.as_ref()),
    );
    let mut next_height = clamp_axis(
        height,
        node.layout
            .constraints
            .as_ref()
            .and_then(|constraints| constraints.height.as_ref()),
    );

    if let Some(size_constraint) = node
        .layout_modifiers
        .as_ref()
        .and_then(|modifiers| modifiers.size_constraint.as_ref())
    {
        if let Some(min_size) = size_constraint.min_size {
            next_width = next_width.max(min_size.x);
            next_height = next_height.max(min_size.y);
        }

        if let Some(max_size) = size_constraint.max_size {
            next_width = next_width.min(max_size.x);
            next_height = next_height.min(max_size.y);
        }
    }

    (next_width.max(0.0), next_height.max(0.0))
}

fn apply_aspect_ratio_constraint(
    node: &PreviewLayoutNode,
    width: f32,
    height: f32,
    dominant_axis_hint: Option<DominantAxisHint>,
) -> (f32, f32) {
    let Some(constraint) = node
        .layout_modifiers
        .as_ref()
        .and_then(|modifiers| modifiers.aspect_ratio_constraint.as_ref())
    else {
        return (width, height);
    };

    if constraint.aspect_ratio <= 0.0 {
        return (width, height);
    }

    let dominant_axis = dominant_axis_hint.or_else(|| match constraint.dominant_axis.as_str() {
        "height" => Some(DominantAxisHint::Height),
        "width" => Some(DominantAxisHint::Width),
        _ if width > 0.0 && height <= 0.0 => Some(DominantAxisHint::Width),
        _ if height > 0.0 && width <= 0.0 => Some(DominantAxisHint::Height),
        _ => Some(DominantAxisHint::Width),
    });

    match dominant_axis.unwrap_or(DominantAxisHint::Width) {
        DominantAxisHint::Height => (height * constraint.aspect_ratio, height),
        DominantAxisHint::Width => (
            width,
            if constraint.aspect_ratio == 0.0 {
                height
            } else {
                width / constraint.aspect_ratio
            },
        ),
    }
}

fn resolve_node_dimensions(
    node: &PreviewLayoutNode,
    parent_rect: &ComputedRect,
    overrides: NodeDimensionOverrides,
) -> (f32, f32) {
    let (base_width, base_height) = resolve_base_node_size(node, parent_rect);
    let mut width = overrides.width.unwrap_or(base_width);
    let mut height = overrides.height.unwrap_or(base_height);

    (width, height) = apply_node_dimension_constraints(node, width, height);
    (width, height) = apply_aspect_ratio_constraint(node, width, height, overrides.dominant_axis);
    (width, height) = apply_node_dimension_constraints(node, width, height);

    (width, height)
}

fn compute_absolute_rect(node: &PreviewLayoutNode, parent_rect: &ComputedRect) -> ComputedRect {
    if node.kind == "root" {
        return ComputedRect {
            x: 0.0,
            y: 0.0,
            width: parent_rect.width,
            height: parent_rect.height,
        };
    }

    let (width, height) = resolve_node_dimensions(node, parent_rect, NodeDimensionOverrides::default());

    ComputedRect {
        x: parent_rect.x + resolve_axis(node.layout.position.x, parent_rect.width)
            - (node.layout.anchor_point.x * width),
        y: parent_rect.y + resolve_axis(node.layout.position.y, parent_rect.height)
            - (node.layout.anchor_point.y * height),
        width,
        height,
    }
}

fn align_start(alignment: &str, available_space: f32) -> f32 {
    match alignment {
        "center" => available_space / 2.0,
        "bottom" | "right" => available_space,
        _ => 0.0,
    }
}

fn positive_floor_to_usize(value: f32) -> usize {
    if !value.is_finite() {
        return 1;
    }

    value.floor().max(1.0) as usize
}

fn positive_ceil_to_usize(value: f32) -> usize {
    if !value.is_finite() {
        return 1;
    }

    value.ceil().max(1.0) as usize
}

fn legacy_to_preview_nodes(
    node: &RobloxNode,
    parent_id: Option<String>,
    output: &mut Vec<PreviewLayoutNode>,
) {
    let preview_node = normalize_root_node(&PreviewLayoutNode {
        debug_label: Some(node.node_type.clone()),
        host_metadata: None,
        id: node.id.clone(),
        intrinsic_size: None,
        kind: if parent_id.is_none() && node.node_type == "ScreenGui" {
            "root".to_owned()
        } else {
            "host".to_owned()
        },
        layout_modifiers: None,
        layout_order: None,
        layout: PreviewNodeLayout {
            anchor_point: node.anchor_point,
            constraints: None,
            position: node.position,
            position_mode: default_position_mode(),
            size: Some(node.size),
        },
        name: None,
        node_type: node.node_type.clone(),
        parent_id: parent_id.clone(),
        source_order: None,
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

    fn child_nodes_for_layout_parent(&self, parent_node: &PreviewLayoutNode) -> Vec<PreviewLayoutNode> {
        let mut child_nodes = self
            .child_ids_for_parent(&parent_node.id)
            .into_iter()
            .filter_map(|child_id| self.nodes.get(&child_id).cloned())
            .collect::<Vec<_>>();
        child_nodes.sort_by(|left, right| compare_nodes_for_parent(parent_node, left, right));
        child_nodes
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

    fn compute_grid_children(
        &mut self,
        parent_node: &PreviewLayoutNode,
        content_rect: ComputedRect,
        child_nodes: Vec<PreviewLayoutNode>,
    ) {
        let Some(grid) = parent_node
            .layout_modifiers
            .as_ref()
            .and_then(|modifiers| modifiers.grid.as_ref())
        else {
            return;
        };

        if child_nodes.is_empty() {
            return;
        }

        let cell_width = resolve_axis(grid.cell_size.x, content_rect.width);
        let cell_height = resolve_axis(grid.cell_size.y, content_rect.height);
        let gap_x = resolve_axis(grid.cell_padding.x, content_rect.width);
        let gap_y = resolve_axis(grid.cell_padding.y, content_rect.height);

        let columns = if grid.fill_direction == "horizontal" {
            if grid.fill_direction_max_cells > 0 {
                grid.fill_direction_max_cells as usize
            } else {
                positive_floor_to_usize(
                    (content_rect.width + gap_x) / (cell_width + gap_x).max(1.0),
                )
            }
        } else {
            let max_rows = if grid.fill_direction_max_cells > 0 {
                grid.fill_direction_max_cells as usize
            } else {
                positive_floor_to_usize(
                    (content_rect.height + gap_y) / (cell_height + gap_y).max(1.0),
                )
            };
            positive_ceil_to_usize(child_nodes.len() as f32 / max_rows as f32)
        };

        let rows = if grid.fill_direction == "horizontal" {
            positive_ceil_to_usize(child_nodes.len() as f32 / columns as f32)
        } else if grid.fill_direction_max_cells > 0 {
            grid.fill_direction_max_cells as usize
        } else {
            positive_floor_to_usize(
                (content_rect.height + gap_y) / (cell_height + gap_y).max(1.0),
            )
        };

        let grid_width = columns as f32 * cell_width + (columns.saturating_sub(1) as f32) * gap_x;
        let grid_height = rows as f32 * cell_height + (rows.saturating_sub(1) as f32) * gap_y;
        let start_x = content_rect.x
            + align_start(
                grid.horizontal_alignment.as_str(),
                (content_rect.width - grid_width).max(0.0),
            );
        let start_y = content_rect.y
            + align_start(
                grid.vertical_alignment.as_str(),
                (content_rect.height - grid_height).max(0.0),
            );
        let invert_columns =
            grid.start_corner == "top-right" || grid.start_corner == "bottom-right";
        let invert_rows =
            grid.start_corner == "bottom-left" || grid.start_corner == "bottom-right";

        for (index, child_node) in child_nodes.iter().enumerate() {
            let raw_column = if grid.fill_direction == "horizontal" {
                index % columns
            } else {
                index / rows
            };
            let raw_row = if grid.fill_direction == "horizontal" {
                index / columns
            } else {
                index % rows
            };
            let column = if invert_columns {
                columns - raw_column - 1
            } else {
                raw_column
            };
            let row = if invert_rows { rows - raw_row - 1 } else { raw_row };
            let cell_x = start_x + column as f32 * (cell_width + gap_x);
            let cell_y = start_y + row as f32 * (cell_height + gap_y);
            let (width, height) = resolve_node_dimensions(
                child_node,
                &ComputedRect {
                    x: cell_x,
                    y: cell_y,
                    width: cell_width,
                    height: cell_height,
                },
                NodeDimensionOverrides {
                    width: Some(cell_width),
                    height: Some(cell_height),
                    dominant_axis: None,
                },
            );

            self.compute_subtree_from_rect(
                &child_node.id,
                ComputedRect {
                    x: cell_x + ((cell_width - width).max(0.0) / 2.0),
                    y: cell_y + ((cell_height - height).max(0.0) / 2.0),
                    width,
                    height,
                },
            );
        }
    }

    fn compute_list_children(
        &mut self,
        parent_node: &PreviewLayoutNode,
        content_rect: ComputedRect,
        child_nodes: Vec<PreviewLayoutNode>,
    ) {
        let Some(list) = parent_node
            .layout_modifiers
            .as_ref()
            .and_then(|modifiers| modifiers.list.as_ref())
        else {
            return;
        };

        if child_nodes.is_empty() {
            return;
        }

        let horizontal = list.fill_direction == "horizontal";
        let gap = resolve_padding_inset(
            Some(&list.padding),
            if horizontal {
                content_rect.width
            } else {
                content_rect.height
            },
        );
        let main_axis_size = if horizontal {
            content_rect.width
        } else {
            content_rect.height
        };
        let cross_axis_size = if horizontal {
            content_rect.height
        } else {
            content_rect.width
        };
        let main_axis_flex = if horizontal {
            list.horizontal_flex.as_deref()
        } else {
            list.vertical_flex.as_deref()
        };
        let cross_axis_flex = if horizontal {
            list.vertical_flex.as_deref()
        } else {
            list.horizontal_flex.as_deref()
        };
        let main_axis_alignment = if horizontal {
            list.horizontal_alignment.as_str()
        } else {
            list.vertical_alignment.as_str()
        };
        let cross_axis_alignment = if horizontal {
            list.vertical_alignment.as_str()
        } else {
            list.horizontal_alignment.as_str()
        };
        let items = child_nodes
            .into_iter()
            .map(|child_node| {
                let (width, height) = resolve_node_dimensions(
                    &child_node,
                    &content_rect,
                    if cross_axis_flex == Some("fill") {
                        if horizontal {
                            NodeDimensionOverrides {
                                width: None,
                                height: Some(cross_axis_size),
                                dominant_axis: Some(DominantAxisHint::Height),
                            }
                        } else {
                            NodeDimensionOverrides {
                                width: Some(cross_axis_size),
                                height: None,
                                dominant_axis: Some(DominantAxisHint::Width),
                            }
                        }
                    } else {
                        NodeDimensionOverrides::default()
                    },
                );
                let flex_item = child_node
                    .layout_modifiers
                    .as_ref()
                    .and_then(|modifiers| modifiers.flex_item.clone());

                ListLayoutItem {
                    cross: if horizontal { height } else { width },
                    flex_item,
                    main: if horizontal { width } else { height },
                    child_node,
                }
            })
            .collect::<Vec<_>>();

        let mut lines = Vec::<Vec<ListLayoutItem>>::new();
        let mut current_line = Vec::<ListLayoutItem>::new();
        let mut current_main = 0.0;

        for item in items {
            let projected_main = if current_line.is_empty() {
                item.main
            } else {
                current_main + gap + item.main
            };

            if list.wraps && !current_line.is_empty() && projected_main > main_axis_size {
                lines.push(current_line);
                current_line = vec![item];
                current_main = current_line[0].main;
                continue;
            }

            current_line.push(item);
            current_main = projected_main;
        }

        if !current_line.is_empty() {
            lines.push(current_line);
        }

        let line_metrics = lines
            .iter()
            .map(|line| {
                let line_main =
                    line.iter().map(|item| item.main).sum::<f32>()
                        + (line.len().saturating_sub(1) as f32) * gap;
                let line_cross = line
                    .iter()
                    .fold(0.0_f32, |maximum, item| maximum.max(item.cross));
                (line_main, line_cross)
            })
            .collect::<Vec<_>>();

        let total_cross = line_metrics
            .iter()
            .map(|(_, line_cross)| *line_cross)
            .sum::<f32>()
            + (line_metrics.len().saturating_sub(1) as f32) * gap;
        let mut cross_cursor = if horizontal {
            content_rect.y
        } else {
            content_rect.x
        } + if list.wraps {
            align_start(cross_axis_alignment, (cross_axis_size - total_cross).max(0.0))
        } else {
            0.0
        };

        for (line_index, line) in lines.iter_mut().enumerate() {
            let (line_main, line_cross) = line_metrics[line_index];
            let remaining_main = main_axis_size - line_main;

            if main_axis_flex == Some("fill") && remaining_main != 0.0 {
                let grow = remaining_main > 0.0;
                let total_weight = line
                    .iter()
                    .filter(|item| {
                        let mode = item
                            .flex_item
                            .as_ref()
                            .and_then(|flex_item| flex_item.flex_mode.as_deref())
                            .unwrap_or("fill");
                        if grow {
                            mode == "fill" || mode == "grow"
                        } else {
                            mode == "fill" || mode == "shrink"
                        }
                    })
                    .map(|item| {
                        let ratio = if grow {
                            item.flex_item
                                .as_ref()
                                .and_then(|flex_item| flex_item.grow_ratio)
                                .unwrap_or(1.0)
                        } else {
                            item.flex_item
                                .as_ref()
                                .and_then(|flex_item| flex_item.shrink_ratio)
                                .unwrap_or(1.0)
                        };
                        ratio.max(0.0)
                    })
                    .sum::<f32>();

                if total_weight > 0.0 {
                    for item in line.iter_mut().filter(|item| {
                        let mode = item
                            .flex_item
                            .as_ref()
                            .and_then(|flex_item| flex_item.flex_mode.as_deref())
                            .unwrap_or("fill");
                        if grow {
                            mode == "fill" || mode == "grow"
                        } else {
                            mode == "fill" || mode == "shrink"
                        }
                    }) {
                        let ratio = if grow {
                            item.flex_item
                                .as_ref()
                                .and_then(|flex_item| flex_item.grow_ratio)
                                .unwrap_or(1.0)
                        } else {
                            item.flex_item
                                .as_ref()
                                .and_then(|flex_item| flex_item.shrink_ratio)
                                .unwrap_or(1.0)
                        };
                        item.main =
                            (item.main + (remaining_main * ratio.max(0.0)) / total_weight).max(0.0);
                    }
                }
            }

            let used_main = line.iter().map(|item| item.main).sum::<f32>()
                + (line.len().saturating_sub(1) as f32) * gap;
            let mut main_cursor = if horizontal {
                content_rect.x
            } else {
                content_rect.y
            } + align_start(main_axis_alignment, (main_axis_size - used_main).max(0.0));

            for item in line.iter() {
                let mut resolved_cross = item.cross;
                let line_alignment = item
                    .flex_item
                    .as_ref()
                    .and_then(|flex_item| flex_item.item_line_alignment.as_deref())
                    .or(list.item_line_alignment.as_deref())
                    .unwrap_or("start");

                if line_alignment == "stretch" {
                    resolved_cross = line_cross;
                }

                let cross_offset = if list.wraps {
                    let wrapped_alignment = match line_alignment {
                        "end" => {
                            if horizontal {
                                "bottom"
                            } else {
                                "right"
                            }
                        }
                        "center" => "center",
                        _ => "top",
                    };
                    align_start(wrapped_alignment, (line_cross - resolved_cross).max(0.0))
                } else {
                    align_start(
                        cross_axis_alignment,
                        (cross_axis_size - resolved_cross).max(0.0),
                    )
                };

                let width = if horizontal { item.main } else { resolved_cross };
                let height = if horizontal { resolved_cross } else { item.main };
                let x = if horizontal {
                    main_cursor
                } else {
                    cross_cursor + cross_offset
                };
                let y = if horizontal {
                    cross_cursor + cross_offset
                } else {
                    main_cursor
                };

                self.compute_subtree_from_rect(
                    &item.child_node.id,
                    ComputedRect {
                        x,
                        y,
                        width,
                        height,
                    },
                );

                main_cursor += item.main + gap;
            }

            cross_cursor += line_cross + gap;
        }
    }

    fn compute_subtree_from_rect(&mut self, node_id: &str, rect: ComputedRect) {
        let Some(node) = self.nodes.get(node_id).cloned() else {
            return;
        };

        self.last_rects.insert(node.id.clone(), rect);

        let child_ids = self.child_ids_for_parent(&node.id);
        if child_ids.is_empty() {
            return;
        }

        let content_rect = resolve_content_rect(rect, &node);

        if node
            .layout_modifiers
            .as_ref()
            .and_then(|modifiers| modifiers.grid.as_ref())
            .is_some()
        {
            self.compute_grid_children(&node, content_rect, self.child_nodes_for_layout_parent(&node));
            return;
        }

        if node
            .layout_modifiers
            .as_ref()
            .and_then(|modifiers| modifiers.list.as_ref())
            .is_some()
        {
            self.compute_list_children(&node, content_rect, self.child_nodes_for_layout_parent(&node));
            return;
        }

        for child_id in child_ids {
            self.compute_subtree(&child_id, &content_rect);
        }
    }

    fn compute_dirty_internal(&mut self) -> Result<PreviewLayoutResult, String> {
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
            .child_ids_for_parent(node_id)
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
        self.sort_node_ids_by_source_order(&mut root_ids);
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
            host_metadata: None,
            id: id.to_owned(),
            intrinsic_size: None,
            kind: kind.to_owned(),
            layout_modifiers: None,
            layout_order: None,
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: zero_size(),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 100.0, 0.0, 40.0)),
            },
            name: Some(id.to_owned()),
            node_type: node_type.to_owned(),
            parent_id: parent_id.map(ToOwned::to_owned),
            source_order: None,
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

        let result = session
            .compute_dirty_internal()
            .expect("layout should compute");

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

        let result = session
            .compute_dirty_internal()
            .expect("layout should compute");

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
        assert_eq!(
            result
                .debug
                .roots
                .first()
                .and_then(|root| root.children.first())
                .map(|node| node.size_resolution.reason.as_str()),
            Some("intrinsic-measurement")
        );
    }

    #[test]
    fn uses_full_size_default_when_explicit_size_is_missing() {
        let mut session = LayoutSession::new();
        session.apply_preview_nodes(vec![
            node("screen", None, "root", "ScreenGui"),
            PreviewLayoutNode {
                host_metadata: Some(PreviewHostMetadata {
                    degraded: true,
                    full_size_default: true,
                    placeholder_behavior: "opaque".to_owned(),
                }),
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: None,
                },
                ..node("viewport", Some("screen"), "host", "ViewportFrame")
            },
        ]);
        session.set_viewport_internal(Viewport {
            height: 480.0,
            width: 640.0,
        });

        let result = session
            .compute_dirty_internal()
            .expect("layout should compute");

        let viewport = result.rects.get("viewport").expect("viewport should exist");
        assert_close(viewport.width, 640.0);
        assert_close(viewport.height, 480.0);
        assert_eq!(
            result
                .debug
                .roots
                .first()
                .and_then(|root| root.children.first())
                .map(|node| node.layout_source.as_str()),
            Some("full-size-default")
        );
        assert_eq!(
            result
                .debug
                .roots
                .first()
                .and_then(|root| root.children.first())
                .map(|node| node.host_policy.placeholder_behavior.as_str()),
            Some("opaque")
        );
        assert_eq!(
            result
                .debug
                .roots
                .first()
                .and_then(|root| root.children.first())
                .map(|node| node.size_resolution.reason.as_str()),
            Some("full-size-default")
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

        let _ = session
            .compute_dirty_internal()
            .expect("initial layout should compute");

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

        assert!(result
            .dirty_node_ids
            .iter()
            .any(|node_id| node_id == "right"));
        assert!(!result
            .dirty_node_ids
            .iter()
            .any(|node_id| node_id == "left"));
    }

    #[test]
    fn deserializes_extended_preview_layout_contract() {
        let node: PreviewLayoutNode = serde_json::from_value(json!({
            "debugLabel": "contract",
            "hostMetadata": {
                "degraded": false,
                "fullSizeDefault": false,
                "placeholderBehavior": "none"
            },
            "id": "contract",
            "kind": "host",
            "layout": {
                "anchorPoint": { "x": 0.0, "y": 0.0 },
                "position": {
                    "x": { "offset": 0.0, "scale": 0.0 },
                    "y": { "offset": 0.0, "scale": 0.0 }
                },
                "positionMode": "absolute",
                "size": {
                    "x": { "offset": 120.0, "scale": 0.0 },
                    "y": { "offset": 40.0, "scale": 0.0 }
                }
            },
            "layoutModifiers": {
                "padding": {
                    "bottom": { "Offset": 4.0, "Scale": 0.0 },
                    "left": { "Offset": 1.0, "Scale": 0.0 },
                    "right": { "Offset": 2.0, "Scale": 0.0 },
                    "top": { "Offset": 3.0, "Scale": 0.0 }
                },
                "textSizeConstraint": {
                    "maxTextSize": 18,
                    "minTextSize": 12
                }
            },
            "layoutOrder": 7,
            "name": "ContractNode",
            "nodeType": "TextLabel",
            "parentId": "screen",
            "sourceOrder": 5
        }))
        .expect("node should deserialize");

        assert_eq!(node.layout_order, Some(7));
        assert_eq!(node.name.as_deref(), Some("ContractNode"));
        assert_eq!(node.source_order, Some(5));
        assert_eq!(
            node.layout_modifiers
                .as_ref()
                .and_then(|modifiers| modifiers.text_size_constraint.as_ref())
                .and_then(|constraint| constraint.max_text_size),
            Some(18)
        );
        assert_eq!(
            node.layout_modifiers
                .as_ref()
                .and_then(|modifiers| modifiers.padding.as_ref())
                .map(|padding| padding.top.offset),
            Some(3.0)
        );
    }

    #[test]
    fn applies_padding_and_list_layout_semantics() {
        let mut session = LayoutSession::new();
        session.apply_preview_nodes(vec![
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(full_size()),
                },
                source_order: Some(0),
                ..node("screen", None, "root", "ScreenGui")
            },
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 200.0, 0.0, 120.0)),
                },
                layout_modifiers: Some(PreviewLayoutModifiers {
                    aspect_ratio_constraint: None,
                    flex_item: None,
                    grid: None,
                    list: Some(PreviewLayoutListLayout {
                        fill_direction: "vertical".to_owned(),
                        horizontal_alignment: "center".to_owned(),
                        horizontal_flex: None,
                        item_line_alignment: None,
                        padding: axis(0.0, 8.0),
                        sort_order: "layout-order".to_owned(),
                        vertical_alignment: "center".to_owned(),
                        vertical_flex: None,
                        wraps: false,
                    }),
                    padding: Some(PreviewLayoutPaddingInsets {
                        bottom: axis(0.0, 10.0),
                        left: axis(0.0, 10.0),
                        right: axis(0.0, 10.0),
                        top: axis(0.0, 10.0),
                    }),
                    size_constraint: None,
                    text_size_constraint: None,
                }),
                source_order: Some(0),
                ..node("frame", Some("screen"), "host", "Frame")
            },
            PreviewLayoutNode {
                layout_order: Some(2),
                source_order: Some(1),
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 40.0, 0.0, 20.0)),
                },
                ..node("second", Some("frame"), "host", "TextLabel")
            },
            PreviewLayoutNode {
                layout_order: Some(1),
                source_order: Some(0),
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 60.0, 0.0, 30.0)),
                },
                ..node("first", Some("frame"), "host", "TextLabel")
            },
        ]);
        session.set_viewport_internal(Viewport {
            height: 200.0,
            width: 300.0,
        });

        let result = session.compute_dirty_internal().expect("layout should compute");
        let first = result.rects.get("first").expect("first should exist");
        let second = result.rects.get("second").expect("second should exist");

        assert_close(first.x, 70.0);
        assert_close(first.y, 31.0);
        assert_close(first.width, 60.0);
        assert_close(first.height, 30.0);
        assert_close(second.x, 80.0);
        assert_close(second.y, 69.0);
        assert_close(second.width, 40.0);
        assert_close(second.height, 20.0);
        assert_eq!(
            result
                .debug
                .roots
                .first()
                .and_then(|root| root.children.first())
                .map(|node| node.children.iter().map(|child| child.id.as_str()).collect::<Vec<_>>()),
            Some(vec!["first", "second"])
        );
    }

    #[test]
    fn applies_grid_layout_semantics() {
        let mut session = LayoutSession::new();
        session.apply_preview_nodes(vec![
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(full_size()),
                },
                ..node("screen", None, "root", "ScreenGui")
            },
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 220.0, 0.0, 140.0)),
                },
                layout_modifiers: Some(PreviewLayoutModifiers {
                    aspect_ratio_constraint: None,
                    flex_item: None,
                    grid: Some(PreviewLayoutGridLayout {
                        cell_padding: size(0.0, 10.0, 0.0, 5.0),
                        cell_size: size(0.0, 50.0, 0.0, 20.0),
                        fill_direction: "horizontal".to_owned(),
                        fill_direction_max_cells: 3,
                        horizontal_alignment: "center".to_owned(),
                        sort_order: "source".to_owned(),
                        start_corner: "top-left".to_owned(),
                        vertical_alignment: "center".to_owned(),
                    }),
                    list: None,
                    padding: None,
                    size_constraint: None,
                    text_size_constraint: None,
                }),
                ..node("frame", Some("screen"), "host", "Frame")
            },
            PreviewLayoutNode {
                source_order: Some(0),
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 50.0, 0.0, 20.0)),
                },
                ..node("grid-1", Some("frame"), "host", "Frame")
            },
            PreviewLayoutNode {
                source_order: Some(1),
                ..node("grid-2", Some("frame"), "host", "Frame")
            },
            PreviewLayoutNode {
                source_order: Some(2),
                ..node("grid-3", Some("frame"), "host", "Frame")
            },
            PreviewLayoutNode {
                source_order: Some(3),
                ..node("grid-4", Some("frame"), "host", "Frame")
            },
        ]);
        session.set_viewport_internal(Viewport {
            height: 200.0,
            width: 300.0,
        });

        let result = session.compute_dirty_internal().expect("layout should compute");
        let first = result.rects.get("grid-1").expect("grid-1 should exist");
        let fourth = result.rects.get("grid-4").expect("grid-4 should exist");

        assert_close(first.x, 25.0);
        assert_close(first.y, 47.5);
        assert_close(fourth.x, 25.0);
        assert_close(fourth.y, 72.5);
    }

    #[test]
    fn applies_size_and_aspect_constraints() {
        let mut session = LayoutSession::new();
        session.apply_preview_nodes(vec![
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(full_size()),
                },
                ..node("screen", None, "root", "ScreenGui")
            },
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 200.0, 0.0, 120.0)),
                },
                ..node("frame", Some("screen"), "host", "Frame")
            },
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 50.0, 0.0, 80.0)),
                },
                layout_modifiers: Some(PreviewLayoutModifiers {
                    aspect_ratio_constraint: Some(PreviewLayoutAspectRatioConstraint {
                        aspect_ratio: 2.0,
                        dominant_axis: "width".to_owned(),
                    }),
                    flex_item: None,
                    grid: None,
                    list: None,
                    padding: None,
                    size_constraint: Some(PreviewLayoutSizeConstraint {
                        max_size: Some(LayoutVector { x: 160.0, y: 120.0 }),
                        min_size: Some(LayoutVector { x: 100.0, y: 40.0 }),
                    }),
                    text_size_constraint: None,
                }),
                ..node("box", Some("frame"), "host", "Frame")
            },
        ]);
        session.set_viewport_internal(Viewport {
            height: 240.0,
            width: 320.0,
        });

        let result = session.compute_dirty_internal().expect("layout should compute");
        let box_rect = result.rects.get("box").expect("box should exist");

        assert_close(box_rect.width, 100.0);
        assert_close(box_rect.height, 50.0);
    }

    #[test]
    fn distributes_flex_grow_ratios() {
        let mut session = LayoutSession::new();
        session.apply_preview_nodes(vec![
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(full_size()),
                },
                ..node("screen", None, "root", "ScreenGui")
            },
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 120.0, 0.0, 100.0)),
                },
                layout_modifiers: Some(PreviewLayoutModifiers {
                    aspect_ratio_constraint: None,
                    flex_item: None,
                    grid: None,
                    list: Some(PreviewLayoutListLayout {
                        fill_direction: "vertical".to_owned(),
                        horizontal_alignment: "left".to_owned(),
                        horizontal_flex: None,
                        item_line_alignment: None,
                        padding: axis(0.0, 0.0),
                        sort_order: "source".to_owned(),
                        vertical_alignment: "top".to_owned(),
                        vertical_flex: Some("fill".to_owned()),
                        wraps: false,
                    }),
                    padding: None,
                    size_constraint: None,
                    text_size_constraint: None,
                }),
                ..node("frame", Some("screen"), "host", "Frame")
            },
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 120.0, 0.0, 20.0)),
                },
                layout_modifiers: Some(PreviewLayoutModifiers {
                    aspect_ratio_constraint: None,
                    flex_item: Some(PreviewLayoutFlexItem {
                        flex_mode: Some("grow".to_owned()),
                        grow_ratio: Some(1.0),
                        item_line_alignment: None,
                        shrink_ratio: None,
                    }),
                    grid: None,
                    list: None,
                    padding: None,
                    size_constraint: None,
                    text_size_constraint: None,
                }),
                ..node("first", Some("frame"), "host", "Frame")
            },
            PreviewLayoutNode {
                layout: PreviewNodeLayout {
                    anchor_point: zero_vector(),
                    constraints: None,
                    position: zero_size(),
                    position_mode: default_position_mode(),
                    size: Some(size(0.0, 120.0, 0.0, 20.0)),
                },
                layout_modifiers: Some(PreviewLayoutModifiers {
                    aspect_ratio_constraint: None,
                    flex_item: Some(PreviewLayoutFlexItem {
                        flex_mode: Some("grow".to_owned()),
                        grow_ratio: Some(2.0),
                        item_line_alignment: None,
                        shrink_ratio: None,
                    }),
                    grid: None,
                    list: None,
                    padding: None,
                    size_constraint: None,
                    text_size_constraint: None,
                }),
                ..node("second", Some("frame"), "host", "Frame")
            },
        ]);
        session.set_viewport_internal(Viewport {
            height: 240.0,
            width: 320.0,
        });

        let result = session.compute_dirty_internal().expect("layout should compute");
        let first = result.rects.get("first").expect("first should exist");
        let second = result.rects.get("second").expect("second should exist");

        assert_close(first.height, 40.0);
        assert_close(second.y, 40.0);
        assert_close(second.height, 60.0);
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

        let result = session
            .compute_dirty_internal()
            .expect("layout should compute");

        let frame = result.rects.get("frame").expect("frame should exist");
        assert_close(frame.x, 350.0);
        assert_close(frame.y, 275.0);
        assert_close(frame.width, 100.0);
        assert_close(frame.height, 50.0);
    }
}
