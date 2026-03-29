use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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
    pub automatic_size: Option<String>,
    #[serde(default)]
    pub constraints: Option<LayoutConstraints>,
    pub position: LayoutSize,
    #[serde(default = "default_position_mode")]
    pub position_mode: String,
    #[serde(
        default = "default_size_constraint_mode",
        alias = "sizeConstraintMode",
        alias = "SizeConstraint"
    )]
    pub size_constraint_mode: String,
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
    #[serde(default = "default_visible")]
    pub visible: bool,
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
    #[serde(
        default = "default_size_constraint_mode",
        alias = "sizeConstraintMode",
        alias = "SizeConstraint"
    )]
    pub size_constraint_mode: String,
    #[serde(default, alias = "Children")]
    pub children: Vec<RobloxNode>,
}

pub(crate) fn default_position_mode() -> String {
    "absolute".to_owned()
}

pub(crate) fn default_size_constraint_mode() -> String {
    "RelativeXY".to_owned()
}

pub(crate) fn default_placeholder_behavior() -> String {
    "none".to_owned()
}

pub(crate) fn default_vertical_fill_direction() -> String {
    "vertical".to_owned()
}

pub(crate) fn default_left_alignment() -> String {
    "left".to_owned()
}

pub(crate) fn default_top_alignment() -> String {
    "top".to_owned()
}

pub(crate) fn default_sort_order() -> String {
    "source".to_owned()
}

pub(crate) fn default_visible() -> bool {
    true
}

fn default_top_left_corner() -> String {
    "top-left".to_owned()
}

pub(crate) fn default_dominant_axis() -> String {
    "auto".to_owned()
}

pub(crate) fn zero_axis() -> LayoutAxis {
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

pub(crate) fn full_size() -> LayoutSize {
    LayoutSize {
        x: full_axis(),
        y: full_axis(),
    }
}

pub(crate) fn zero_size() -> LayoutSize {
    LayoutSize {
        x: zero_axis(),
        y: zero_axis(),
    }
}

pub(crate) fn zero_vector() -> LayoutVector {
    LayoutVector { x: 0.0, y: 0.0 }
}
