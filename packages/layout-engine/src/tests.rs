use super::*;
use crate::model::{default_position_mode, full_size, zero_size, zero_vector};
use crate::resolve::legacy_to_preview_nodes;
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

    let result = session
        .compute_dirty_internal()
        .expect("layout should compute");
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
            .map(|node| node
                .children
                .iter()
                .map(|child| child.id.as_str())
                .collect::<Vec<_>>()),
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

    let result = session
        .compute_dirty_internal()
        .expect("layout should compute");
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

    let result = session
        .compute_dirty_internal()
        .expect("layout should compute");
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

    let result = session
        .compute_dirty_internal()
        .expect("layout should compute");
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

#[test]
fn remove_nodes_clears_subtree_rects_and_marks_removed_nodes_dirty() {
    let mut session = LayoutSession::new();
    session.apply_preview_nodes(vec![
        node("screen", None, "root", "ScreenGui"),
        node("frame", Some("screen"), "host", "Frame"),
        node("leaf", Some("frame"), "host", "TextLabel"),
    ]);
    session.set_viewport_internal(Viewport {
        height: 200.0,
        width: 300.0,
    });

    let _ = session
        .compute_dirty_internal()
        .expect("initial layout should compute");

    session.remove_node_ids(vec!["frame".to_owned()]);

    let result = session
        .compute_dirty_internal()
        .expect("removal layout should compute");

    assert!(!result.rects.contains_key("frame"));
    assert!(!result.rects.contains_key("leaf"));
    assert!(result
        .dirty_node_ids
        .iter()
        .any(|node_id| node_id == "frame"));
    assert!(result
        .dirty_node_ids
        .iter()
        .any(|node_id| node_id == "leaf"));
}

#[test]
fn normalizes_top_level_screen_gui_roots() {
    let mut session = LayoutSession::new();
    session.apply_preview_nodes(vec![PreviewLayoutNode {
        layout: PreviewNodeLayout {
            anchor_point: LayoutVector { x: 0.5, y: 0.5 },
            constraints: None,
            position: size(0.25, 15.0, 0.5, 20.0),
            position_mode: default_position_mode(),
            size: Some(size(0.0, 150.0, 0.0, 80.0)),
        },
        ..node("screen", None, "host", "ScreenGui")
    }]);
    session.set_viewport_internal(Viewport {
        height: 600.0,
        width: 800.0,
    });

    let result = session
        .compute_dirty_internal()
        .expect("normalized layout should compute");
    let screen = result.rects.get("screen").expect("screen should exist");

    assert_close(screen.x, 0.0);
    assert_close(screen.y, 0.0);
    assert_close(screen.width, 800.0);
    assert_close(screen.height, 600.0);
    assert_eq!(
        result.debug.roots.first().map(|root| root.kind.as_str()),
        Some("root")
    );
    assert_eq!(
        result
            .debug
            .roots
            .first()
            .map(|root| root.layout_source.as_str()),
        Some("root-default")
    );
}

#[test]
fn list_and_grid_sort_orders_follow_requested_strategy() {
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
                position: size(0.0, 0.0, 0.0, 0.0),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 100.0, 0.0, 40.0)),
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
                    vertical_flex: None,
                    wraps: false,
                }),
                padding: None,
                size_constraint: None,
                text_size_constraint: None,
            }),
            ..node("source-list", Some("screen"), "host", "Frame")
        },
        PreviewLayoutNode {
            source_order: Some(0),
            layout_order: Some(5),
            name: Some("Zulu".to_owned()),
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: zero_size(),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 10.0, 0.0, 10.0)),
            },
            ..node("source-first", Some("source-list"), "host", "Frame")
        },
        PreviewLayoutNode {
            source_order: Some(1),
            layout_order: Some(0),
            name: Some("Alpha".to_owned()),
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: zero_size(),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 10.0, 0.0, 10.0)),
            },
            ..node("source-second", Some("source-list"), "host", "Frame")
        },
        PreviewLayoutNode {
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: size(0.0, 120.0, 0.0, 0.0),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 100.0, 0.0, 40.0)),
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
                    sort_order: "name".to_owned(),
                    vertical_alignment: "top".to_owned(),
                    vertical_flex: None,
                    wraps: false,
                }),
                padding: None,
                size_constraint: None,
                text_size_constraint: None,
            }),
            ..node("name-list", Some("screen"), "host", "Frame")
        },
        PreviewLayoutNode {
            source_order: Some(1),
            name: Some("Alpha".to_owned()),
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: zero_size(),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 10.0, 0.0, 10.0)),
            },
            ..node("name-first", Some("name-list"), "host", "Frame")
        },
        PreviewLayoutNode {
            source_order: Some(0),
            name: Some("Zulu".to_owned()),
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: zero_size(),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 10.0, 0.0, 10.0)),
            },
            ..node("name-second", Some("name-list"), "host", "Frame")
        },
        PreviewLayoutNode {
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: size(0.0, 0.0, 0.0, 60.0),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 100.0, 0.0, 40.0)),
            },
            layout_modifiers: Some(PreviewLayoutModifiers {
                aspect_ratio_constraint: None,
                flex_item: None,
                grid: Some(PreviewLayoutGridLayout {
                    cell_padding: zero_size(),
                    cell_size: size(0.0, 20.0, 0.0, 20.0),
                    fill_direction: "horizontal".to_owned(),
                    fill_direction_max_cells: 2,
                    horizontal_alignment: "left".to_owned(),
                    sort_order: "layout-order".to_owned(),
                    start_corner: "top-left".to_owned(),
                    vertical_alignment: "top".to_owned(),
                }),
                list: None,
                padding: None,
                size_constraint: None,
                text_size_constraint: None,
            }),
            ..node("grid-layout", Some("screen"), "host", "Frame")
        },
        PreviewLayoutNode {
            source_order: Some(1),
            layout_order: Some(1),
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: zero_size(),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 20.0, 0.0, 20.0)),
            },
            ..node("grid-first", Some("grid-layout"), "host", "Frame")
        },
        PreviewLayoutNode {
            source_order: Some(0),
            layout_order: Some(2),
            layout: PreviewNodeLayout {
                anchor_point: zero_vector(),
                constraints: None,
                position: zero_size(),
                position_mode: default_position_mode(),
                size: Some(size(0.0, 20.0, 0.0, 20.0)),
            },
            ..node("grid-second", Some("grid-layout"), "host", "Frame")
        },
    ]);
    session.set_viewport_internal(Viewport {
        height: 200.0,
        width: 300.0,
    });

    let result = session
        .compute_dirty_internal()
        .expect("layout should compute");

    let source_first = result
        .rects
        .get("source-first")
        .expect("source-first should exist");
    let source_second = result
        .rects
        .get("source-second")
        .expect("source-second should exist");
    let name_first = result
        .rects
        .get("name-first")
        .expect("name-first should exist");
    let name_second = result
        .rects
        .get("name-second")
        .expect("name-second should exist");
    let grid_first = result
        .rects
        .get("grid-first")
        .expect("grid-first should exist");
    let grid_second = result
        .rects
        .get("grid-second")
        .expect("grid-second should exist");

    assert_close(source_first.y, 0.0);
    assert_close(source_second.y, 10.0);
    assert_close(name_first.y, 0.0);
    assert_close(name_second.y, 10.0);
    assert_close(grid_first.x, 0.0);
    assert_close(grid_second.x, 20.0);
}
