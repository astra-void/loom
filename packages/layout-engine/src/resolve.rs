use std::cmp::Ordering;

use crate::model::{
    default_placeholder_behavior, default_position_mode, full_size, zero_size, zero_vector,
    ComputedRect, LayoutAxis, LayoutAxisConstraints, LayoutSize, MeasuredNodeSize,
    PreviewHostMetadata, PreviewLayoutNode, PreviewLayoutSizeResolution, PreviewNodeLayout,
    RobloxNode, Viewport,
};

#[derive(Debug, Clone, Copy)]
enum DominantAxisHint {
    Height,
    Width,
}

#[derive(Debug, Clone, Copy)]
enum SizeConstraintMode {
    RelativeXX,
    RelativeXY,
    RelativeYY,
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

fn parse_size_constraint_mode(value: &str) -> SizeConstraintMode {
    match value {
        "RelativeXX" => SizeConstraintMode::RelativeXX,
        "RelativeYY" => SizeConstraintMode::RelativeYY,
        _ => SizeConstraintMode::RelativeXY,
    }
}

fn resolve_axis_for_size_constraint_mode(
    axis: LayoutAxis,
    parent_rect: &ComputedRect,
    mode: SizeConstraintMode,
    is_x: bool,
) -> f32 {
    let reference_size = match mode {
        SizeConstraintMode::RelativeXX => parent_rect.width,
        SizeConstraintMode::RelativeYY => parent_rect.height,
        SizeConstraintMode::RelativeXY if is_x => parent_rect.width,
        SizeConstraintMode::RelativeXY => parent_rect.height,
    };

    resolve_axis(axis, reference_size)
}

pub(crate) fn create_viewport_rect(viewport: Viewport) -> ComputedRect {
    ComputedRect {
        x: 0.0,
        y: 0.0,
        width: viewport.width,
        height: viewport.height,
    }
}

pub(crate) fn resolve_axis(axis: LayoutAxis, parent_axis_size: f32) -> f32 {
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

pub(crate) fn normalize_root_node(node: &PreviewLayoutNode) -> PreviewLayoutNode {
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

pub(crate) fn resolve_host_policy(node: &PreviewLayoutNode) -> PreviewHostMetadata {
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

pub(crate) fn resolve_size_resolution(node: &PreviewLayoutNode) -> PreviewLayoutSizeResolution {
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

pub(crate) fn resolve_layout_source(node: &PreviewLayoutNode) -> &'static str {
    resolve_node_size(node).layout_source
}

pub(crate) fn resolve_padding_inset(value: Option<&LayoutAxis>, reference_size: f32) -> f32 {
    let Some(axis) = value else {
        return 0.0;
    };

    (reference_size * axis.scale + axis.offset).max(0.0)
}

pub(crate) fn resolve_content_rect(rect: ComputedRect, node: &PreviewLayoutNode) -> ComputedRect {
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

fn resolve_node_name(node: &PreviewLayoutNode) -> &str {
    node.name
        .as_deref()
        .or(node.debug_label.as_deref())
        .unwrap_or(node.id.as_str())
}

pub(crate) fn compare_source_order(
    left: &PreviewLayoutNode,
    right: &PreviewLayoutNode,
) -> Ordering {
    let left_order = left.source_order.unwrap_or(i32::MAX);
    let right_order = right.source_order.unwrap_or(i32::MAX);

    left_order
        .cmp(&right_order)
        .then_with(|| left.id.cmp(&right.id))
}

pub(crate) fn compare_nodes_for_parent(
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
    let mode = parse_size_constraint_mode(node.layout.size_constraint_mode.as_str());
    (
        resolve_axis_for_size_constraint_mode(resolved.resolved_size.x, parent_rect, mode, true),
        resolve_axis_for_size_constraint_mode(resolved.resolved_size.y, parent_rect, mode, false),
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

pub(crate) fn resolve_node_dimensions(
    node: &PreviewLayoutNode,
    parent_rect: &ComputedRect,
) -> (f32, f32) {
    resolve_node_dimensions_with_overrides(node, parent_rect, None, None, None)
}

pub(crate) fn resolve_node_dimensions_with_overrides(
    node: &PreviewLayoutNode,
    parent_rect: &ComputedRect,
    width_override: Option<f32>,
    height_override: Option<f32>,
    dominant_axis_is_height: Option<bool>,
) -> (f32, f32) {
    let dominant_axis = dominant_axis_is_height.map(|is_height| {
        if is_height {
            DominantAxisHint::Height
        } else {
            DominantAxisHint::Width
        }
    });
    let overrides = NodeDimensionOverrides {
        dominant_axis,
        height: height_override,
        width: width_override,
    };
    let (base_width, base_height) = resolve_base_node_size(node, parent_rect);
    let mut width = overrides.width.unwrap_or(base_width);
    let mut height = overrides.height.unwrap_or(base_height);

    (width, height) = apply_node_dimension_constraints(node, width, height);
    (width, height) = apply_aspect_ratio_constraint(node, width, height, overrides.dominant_axis);
    (width, height) = apply_node_dimension_constraints(node, width, height);

    (width, height)
}

pub(crate) fn compute_absolute_rect(
    node: &PreviewLayoutNode,
    parent_rect: &ComputedRect,
) -> ComputedRect {
    if node.kind == "root" {
        return ComputedRect {
            x: 0.0,
            y: 0.0,
            width: parent_rect.width,
            height: parent_rect.height,
        };
    }

    let (width, height) = resolve_node_dimensions(node, parent_rect);

    ComputedRect {
        x: parent_rect.x + resolve_axis(node.layout.position.x, parent_rect.width)
            - (node.layout.anchor_point.x * width),
        y: parent_rect.y + resolve_axis(node.layout.position.y, parent_rect.height)
            - (node.layout.anchor_point.y * height),
        width,
        height,
    }
}

pub(crate) fn legacy_to_preview_nodes(
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
            size_constraint_mode: node.size_constraint_mode.clone(),
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

pub(crate) fn sort_ids(ids: &mut Vec<String>) {
    ids.sort();
    ids.dedup();
}





