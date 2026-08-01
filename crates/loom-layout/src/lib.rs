//! Loom layout engine (pure Rust, native-testable).
//!
//! Computes an absolute pixel [`Rect`] for every layout-participating node in a
//! [`SceneNode`] tree, given a [`Viewport`]. Origin is top-left, y-down
//! (DOM-aligned). All math is f64.
//!
//! Roblox semantics implemented here:
//! - Own size: `Size` UDim2 -> resolve -> `UIAspectRatioConstraint` -> `UISizeConstraint`
//!   clamp -> `AutomaticSize` grow-to-content. Then `AnchorPoint`/`Position` place it.
//! - `UIPadding` insets the content box; `UIListLayout`/`UIGridLayout` flow children
//!   (ignoring their Position/AnchorPoint); `ScrollingFrame` lays children out against
//!   its `CanvasSize`.
//! - The TOP node always fills the viewport, regardless of className.
//! - Non-layout modifier children get no rect and do not advance the positional id.
//!
//! Deferred (documented): text measurement (needs font metrics — lands with M4 text),
//! f32 pixel-snapping parity, `SizeConstraint` axis modes, grid `StartCorner` variants,
//! `AspectType: ScaleWithParentSize`, `CanvasPosition`/scroll offset, `ScrollBarThickness`
//! (the scrollbar-reserved `AbsoluteWindowSize`), `AutomaticSize` combined with an explicit
//! `CanvasSize` on a `ScrollingFrame`, and scale `UIPadding` on an `AutomaticSize` axis
//! (treated as offset-only so measurement and placement agree).

use loom_scene::{
    participates_in_layout, LayoutNode, LayoutResult, PropertyValue, Rect, SceneNode, UDim,
    Vector2, Viewport,
};
use std::collections::BTreeMap;
use std::fmt;

/// A layout failure. The geometry math never errors; this only surfaces a
/// malformed scene the adapter must fix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LayoutError {
    /// Two layout-participating nodes resolve to the same id.
    DuplicateId(String),
}

impl fmt::Display for LayoutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LayoutError::DuplicateId(id) => write!(f, "duplicate layout id: {id}"),
        }
    }
}

impl std::error::Error for LayoutError {}

// --- small readers -----------------------------------------------------------

#[inline]
fn resolve_axis(u: UDim, parent_axis_px: f64) -> f64 {
    parent_axis_px * u.scale + u.offset
}

fn find_modifier<'a>(node: &'a SceneNode, class: &str) -> Option<&'a SceneNode> {
    node.children.iter().find(|c| c.class_name == class)
}

fn udim_prop(node: &SceneNode, key: &str) -> Option<UDim> {
    node.properties.get(key).and_then(PropertyValue::as_udim)
}

fn num_prop(node: &SceneNode, key: &str) -> Option<f64> {
    node.properties.get(key).and_then(PropertyValue::as_number)
}

fn vec2_prop(node: &SceneNode, key: &str) -> Option<Vector2> {
    node.properties.get(key).and_then(PropertyValue::as_vector2)
}

fn enum_name<'a>(node: &'a SceneNode, key: &str) -> Option<&'a str> {
    node.properties
        .get(key)
        .and_then(PropertyValue::as_enum)
        .map(|e| e.name.as_str())
}

/// Aligned start offset of a block of `block` px within `space` px.
fn align_offset(space: f64, block: f64, align: &str) -> f64 {
    match align {
        "Center" => (space - block) / 2.0,
        "Right" | "Bottom" => space - block,
        _ => 0.0, // Left / Top
    }
}

// --- own size: constraints + automatic size ----------------------------------

/// `(auto_x, auto_y)` from `AutomaticSize`.
fn automatic_axes(node: &SceneNode) -> (bool, bool) {
    match enum_name(node, "AutomaticSize") {
        Some("X") => (true, false),
        Some("Y") => (false, true),
        Some("XY") => (true, true),
        _ => (false, false),
    }
}

/// Padding insets `(left, right, top, bottom)` from a `UIPadding` child, resolved
/// against `(w, h)`. On an AutomaticSize axis, scale padding is resolved against 0
/// (offset only) so the auto-size measurement and the placement content box agree
/// — a scale-padded auto axis is otherwise circular. The single shared reader for
/// both `resolve_size` and `content_box` so they can never diverge.
fn padding_insets(node: &SceneNode, w: f64, h: f64) -> (f64, f64, f64, f64) {
    let Some(pad) = find_modifier(node, "UIPadding") else {
        return (0.0, 0.0, 0.0, 0.0);
    };
    let (ax, ay) = automatic_axes(node);
    let xref = if ax { 0.0 } else { w };
    let yref = if ay { 0.0 } else { h };
    let l = udim_prop(pad, "PaddingLeft").map_or(0.0, |u| resolve_axis(u, xref));
    let r = udim_prop(pad, "PaddingRight").map_or(0.0, |u| resolve_axis(u, xref));
    let t = udim_prop(pad, "PaddingTop").map_or(0.0, |u| resolve_axis(u, yref));
    let b = udim_prop(pad, "PaddingBottom").map_or(0.0, |u| resolve_axis(u, yref));
    (l, r, t, b)
}

/// `UIAspectRatioConstraint` (FitWithinMaxSize approximated by DominantAxis).
fn apply_aspect_ratio(node: &SceneNode, w: f64, h: f64) -> (f64, f64) {
    let Some(arc) = find_modifier(node, "UIAspectRatioConstraint") else {
        return (w, h);
    };
    let ratio = num_prop(arc, "AspectRatio").unwrap_or(1.0);
    if ratio <= 0.0 {
        return (w, h);
    }
    if enum_name(arc, "DominantAxis") == Some("Height") {
        (h * ratio, h)
    } else {
        (w, w / ratio)
    }
}

/// `UISizeConstraint` Min/Max clamp.
fn apply_size_constraint(node: &SceneNode, w: f64, h: f64) -> (f64, f64) {
    let Some(sc) = find_modifier(node, "UISizeConstraint") else {
        return (w, h);
    };
    let min = vec2_prop(sc, "MinSize").unwrap_or(Vector2 { x: 0.0, y: 0.0 });
    let mut w = w.max(min.x);
    let mut h = h.max(min.y);
    if let Some(max) = vec2_prop(sc, "MaxSize") {
        w = w.min(max.x);
        h = h.min(max.y);
    }
    (w, h)
}

/// Size from the `Size` UDim2 plus aspect-ratio and min/max constraints (before
/// AutomaticSize).
fn base_size(node: &SceneNode, parent: Rect) -> (f64, f64) {
    let s = node.size();
    let w = resolve_axis(s.x, parent.width).max(0.0);
    let h = resolve_axis(s.y, parent.height).max(0.0);
    let (w, h) = apply_aspect_ratio(node, w, h);
    apply_size_constraint(node, w, h)
}

/// Final resolved `(width, height)` of a node: base size grown by AutomaticSize.
fn resolve_size(node: &SceneNode, parent: Rect) -> (f64, f64) {
    let (w, h) = base_size(node, parent);
    let (ax, ay) = automatic_axes(node);
    if !ax && !ay {
        return (w, h);
    }
    let (l, r, t, b) = padding_insets(node, w, h);
    let (pad_x, pad_y) = (l + r, t + b);
    let (content_w, content_h) = measure_content(node, (w - pad_x).max(0.0), (h - pad_y).max(0.0));
    let measured_w = content_w + pad_x;
    let measured_h = content_h + pad_y;

    let new_w = if ax { w.max(measured_w) } else { w };
    let new_h = if ay { h.max(measured_h) } else { h };
    (new_w, new_h)
}

/// The bounding content size of `node`'s children, given a content box of
/// `(content_w, content_h)`. Used by AutomaticSize.
fn measure_content(node: &SceneNode, content_w: f64, content_h: f64) -> (f64, f64) {
    let content = Rect {
        x: 0.0,
        y: 0.0,
        width: content_w,
        height: content_h,
    };
    let children = layout_children(node);

    let (mut w, mut h) = if let Some(list) = find_modifier(node, "UIListLayout") {
        let m = list_metrics(content, list, &children);
        if m.vertical {
            (m.cross_max, m.total_main)
        } else {
            (m.total_main, m.cross_max)
        }
    } else if let Some(grid) = find_modifier(node, "UIGridLayout") {
        let g = grid_metrics(content, grid, children.len());
        (g.block_w, g.block_h)
    } else {
        // Free children: bounding box via the SAME placement math as child_rect (so
        // AnchorPoint is honored and the measured extent matches where children land).
        // NOTE: scale Position on the auto axis resolves against a ~0 content size and
        // is dropped (consistent with the deferred scale-on-auto-axis limitation).
        let mut max_w: f64 = 0.0;
        let mut max_h: f64 = 0.0;
        for &(_, child) in &children {
            let r = child_rect(child, content);
            max_w = max_w.max(r.x + r.width);
            max_h = max_h.max(r.y + r.height);
        }
        (max_w, max_h)
    };

    // A text class contributes its measured `TextBounds` (a Vector2 injected by the
    // adapter, since font metrics live browser-side). Auto-size hugs the larger of
    // the children bounding box and the text.
    if let Some(tb) = vec2_prop(node, "TextBounds") {
        w = w.max(tb.x);
        h = h.max(tb.y);
    }
    (w, h)
}

// --- content box (padding + scrolling canvas) --------------------------------

/// The box children lay out within: a `ScrollingFrame`'s `CanvasSize` (so content
/// can exceed the window), then inset by `UIPadding`.
fn content_box(node: &SceneNode, rect: Rect) -> Rect {
    let mut content = rect;
    if node.class_name == "ScrollingFrame" {
        if let Some(cs) = node
            .properties
            .get("CanvasSize")
            .and_then(PropertyValue::as_udim2)
        {
            let cw = resolve_axis(cs.x, rect.width);
            let ch = resolve_axis(cs.y, rect.height);
            content.width = if cw > 0.0 { cw } else { rect.width };
            content.height = if ch > 0.0 { ch } else { rect.height };
        }
    }
    let (l, r, t, b) = padding_insets(node, content.width, content.height);
    Rect {
        x: content.x + l,
        y: content.y + t,
        width: (content.width - l - r).max(0.0),
        height: (content.height - t - b).max(0.0),
    }
}

// --- child collection + flow order -------------------------------------------

/// Layout-participating children tagged with their positional id index.
fn layout_children(node: &SceneNode) -> Vec<(usize, &SceneNode)> {
    node.children
        .iter()
        .filter(|c| participates_in_layout(&c.class_name))
        .enumerate()
        .collect()
}

/// Flow order (stable; equal keys keep source order), preserving positional ids.
fn flow_order<'a>(
    children: &[(usize, &'a SceneNode)],
    modifier: &SceneNode,
) -> Vec<(usize, &'a SceneNode)> {
    let mut order = children.to_vec();
    if enum_name(modifier, "SortOrder").unwrap_or("LayoutOrder") == "Name" {
        order.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    } else {
        order.sort_by_key(|(_, c)| {
            c.properties
                .get("LayoutOrder")
                .and_then(PropertyValue::as_int)
                .unwrap_or(0)
        });
    }
    order
}

// --- UIListLayout ------------------------------------------------------------

struct ListMetrics {
    vertical: bool,
    total_main: f64,
    cross_max: f64,
}

fn list_metrics(content: Rect, list: &SceneNode, children: &[(usize, &SceneNode)]) -> ListMetrics {
    let vertical = enum_name(list, "FillDirection") != Some("Horizontal");
    let main_content = if vertical {
        content.height
    } else {
        content.width
    };
    let gap = udim_prop(list, "Padding").map_or(0.0, |u| resolve_axis(u, main_content));
    // Roblox UIListLayout ignores `Visible = false` siblings: they take neither a
    // slot nor a gap, so the visible items pack together (and AutomaticSize hugs
    // only them). Measure over the visible children alone.
    let mut total_main = 0.0;
    let mut cross_max: f64 = 0.0;
    let mut visible_count = 0usize;
    for &(_, child) in children {
        if !child.visible() {
            continue;
        }
        let (w, h) = resolve_size(child, content);
        let (main, cross) = if vertical { (h, w) } else { (w, h) };
        total_main += main;
        cross_max = cross_max.max(cross);
        visible_count += 1;
    }
    total_main += gap * (visible_count.saturating_sub(1) as f64);
    ListMetrics {
        vertical,
        total_main,
        cross_max,
    }
}

/// `UIFlexItem.FlexMode` on a child → its share of the leftover main-axis space.
/// `Grow`/`Fill` take an equal share; `Custom` uses `GrowRatio`; everything else
/// (and no `UIFlexItem` at all) keeps its resolved size.
fn flex_grow_weight(child: &SceneNode) -> f64 {
    let item = match find_modifier(child, "UIFlexItem") {
        Some(item) => item,
        None => return 0.0,
    };
    match enum_name(item, "FlexMode") {
        Some("Grow") | Some("Fill") => 1.0,
        Some("Custom") => num_prop(item, "GrowRatio").unwrap_or(0.0).max(0.0),
        _ => 0.0,
    }
}

/// How `UIListLayout`'s flex spreads leftover main-axis space: an offset before
/// the first item and an extra gap between items. Alignment still decides the
/// offset when there is no flex (or nothing left to spread).
struct FlexSpacing {
    start: f64,
    between: f64,
}

fn flex_spacing(flex: &str, free: f64, count: usize) -> Option<FlexSpacing> {
    if free <= 0.0 || count == 0 {
        return None;
    }
    match flex {
        // With one item there is nothing to space *between*, and Roblox leaves it
        // where the alignment put it.
        "SpaceBetween" if count > 1 => Some(FlexSpacing {
            start: 0.0,
            between: free / (count - 1) as f64,
        }),
        "SpaceAround" => {
            let pad = free / count as f64;
            Some(FlexSpacing {
                start: pad / 2.0,
                between: pad,
            })
        }
        "SpaceEvenly" => {
            let pad = free / (count + 1) as f64;
            Some(FlexSpacing {
                start: pad,
                between: pad,
            })
        }
        _ => None,
    }
}

fn place_with_list(
    content: Rect,
    list: &SceneNode,
    children: &[(usize, &SceneNode)],
    parent_path: &str,
    out: &mut BTreeMap<String, LayoutNode>,
) -> Result<(), LayoutError> {
    let order = flow_order(children, list);
    let m = list_metrics(content, list, &order);
    let vertical = m.vertical;
    let main_content = if vertical {
        content.height
    } else {
        content.width
    };
    let cross_content = if vertical {
        content.width
    } else {
        content.height
    };
    let gap = udim_prop(list, "Padding").map_or(0.0, |u| resolve_axis(u, main_content));

    let h_align = enum_name(list, "HorizontalAlignment").unwrap_or("Left");
    let v_align = enum_name(list, "VerticalAlignment").unwrap_or("Top");
    let main_align = if vertical { v_align } else { h_align };
    let cross_align = if vertical { h_align } else { v_align };

    // `HorizontalFlex`/`VerticalFlex` are axis-named, like the alignment
    // properties: whichever one matches the fill direction spreads the leftover
    // space along it, and the other one only means anything as `Fill` (stretch).
    let h_flex = enum_name(list, "HorizontalFlex").unwrap_or("None");
    let v_flex = enum_name(list, "VerticalFlex").unwrap_or("None");
    let main_flex = if vertical { v_flex } else { h_flex };
    let cross_flex = if vertical { h_flex } else { v_flex };

    let visible_count = order.iter().filter(|(_, c)| c.visible()).count();
    let free = (main_content - m.total_main).max(0.0);

    // `Fill` on the main axis grows every item, which is the same distribution a
    // per-child `UIFlexItem` asks for — so an explicit `UIFlexItem` anywhere in
    // the row wins, and `Fill` is the fallback that gives each item weight 1.
    let explicit_weight: f64 = order
        .iter()
        .filter(|(_, c)| c.visible())
        .map(|&(_, c)| flex_grow_weight(c))
        .sum();
    let fill_all = explicit_weight <= 0.0 && main_flex == "Fill";
    let weight_sum = if fill_all {
        visible_count as f64
    } else {
        explicit_weight
    };
    let per_weight = if weight_sum > 0.0 {
        free / weight_sum
    } else {
        0.0
    };

    // Growing consumes the leftover space, so the two never apply at once.
    let spacing = if weight_sum > 0.0 {
        None
    } else {
        flex_spacing(main_flex, free, visible_count)
    };

    let mut cursor = match &spacing {
        Some(s) => s.start,
        None => align_offset(main_content, m.total_main, main_align),
    };
    let between = spacing.as_ref().map_or(0.0, |s| s.between);

    for &(idx, child) in &order {
        let (w, h) = resolve_size(child, content);
        let (mut main_size, mut cross_size) = if vertical { (h, w) } else { (w, h) };
        if child.visible() && per_weight > 0.0 {
            let weight = if fill_all {
                1.0
            } else {
                flex_grow_weight(child)
            };
            main_size += weight * per_weight;
        }
        if cross_flex == "Fill" {
            cross_size = cross_content;
        }
        let cross_off = align_offset(cross_content, cross_size, cross_align);
        let rect = if vertical {
            Rect {
                x: content.x + cross_off,
                y: content.y + cursor,
                width: cross_size,
                height: main_size,
            }
        } else {
            Rect {
                x: content.x + cursor,
                y: content.y + cross_off,
                width: main_size,
                height: cross_size,
            }
        };
        place_node(child, rect, format!("{parent_path}/{idx}"), out)?;
        // `Visible = false` children still get a rect (the renderer hides them via
        // CSS), but they must not consume flow space — mirror Roblox by advancing
        // the cursor only for visible items so the rest pack up against them.
        if child.visible() {
            cursor += main_size + gap + between;
        }
    }
    Ok(())
}

// --- UIGridLayout (horizontal/vertical fill; StartCorner TopLeft) -------------

struct GridMetrics {
    cell_w: f64,
    cell_h: f64,
    pad_x: f64,
    pad_y: f64,
    /// Cells along the fill direction before wrapping.
    per_line: usize,
    vertical: bool,
    block_w: f64,
    block_h: f64,
}

fn grid_metrics(content: Rect, grid: &SceneNode, count: usize) -> GridMetrics {
    let cell = grid
        .properties
        .get("CellSize")
        .and_then(PropertyValue::as_udim2)
        .map(|u| {
            (
                resolve_axis(u.x, content.width),
                resolve_axis(u.y, content.height),
            )
        })
        .unwrap_or((100.0, 100.0)); // Roblox default CellSize {0,100},{0,100}
    let cellpad = grid
        .properties
        .get("CellPadding")
        .and_then(PropertyValue::as_udim2)
        .map(|u| {
            (
                resolve_axis(u.x, content.width),
                resolve_axis(u.y, content.height),
            )
        })
        .unwrap_or((5.0, 5.0)); // Roblox default CellPadding {0,5},{0,5}
    let (cell_w, cell_h) = cell;
    let (pad_x, pad_y) = cellpad;
    let vertical = enum_name(grid, "FillDirection") == Some("Vertical");

    let max_cells = grid
        .properties
        .get("FillDirectionMaxCells")
        .and_then(PropertyValue::as_int)
        .unwrap_or(0)
        .max(0) as usize;
    let (line_len, cell_main, pad_main) = if vertical {
        (content.height, cell_h, pad_y)
    } else {
        (content.width, cell_w, pad_x)
    };
    let per_line = if max_cells > 0 {
        max_cells
    } else if line_len <= 0.0 {
        // Unconstrained fill axis (AutomaticSize on it): one line, no wrap, so the
        // grid grows ALONG the fill direction rather than collapsing to one cell.
        count.max(1)
    } else if cell_main + pad_main > 0.0 {
        (((line_len + pad_main) / (cell_main + pad_main)).floor() as usize).max(1)
    } else {
        1
    };

    let lines = count.div_ceil(per_line.max(1));
    let along = if count == 0 { 0 } else { per_line.min(count) };
    // Block extent (in fill / cross axes).
    let fill_cells = along as f64;
    let cross_cells = lines as f64;
    let block_main = fill_cells * cell_main + (fill_cells - 1.0).max(0.0) * pad_main;
    let (cross_cell, cross_pad) = if vertical {
        (cell_w, pad_x)
    } else {
        (cell_h, pad_y)
    };
    let block_cross = cross_cells * cross_cell + (cross_cells - 1.0).max(0.0) * cross_pad;
    let (block_w, block_h) = if vertical {
        (block_cross, block_main)
    } else {
        (block_main, block_cross)
    };

    GridMetrics {
        cell_w,
        cell_h,
        pad_x,
        pad_y,
        per_line,
        vertical,
        block_w,
        block_h,
    }
}

fn place_with_grid(
    content: Rect,
    grid: &SceneNode,
    children: &[(usize, &SceneNode)],
    parent_path: &str,
    out: &mut BTreeMap<String, LayoutNode>,
) -> Result<(), LayoutError> {
    let order = flow_order(children, grid);
    let g = grid_metrics(content, grid, order.len());
    let h_align = enum_name(grid, "HorizontalAlignment").unwrap_or("Left");
    let v_align = enum_name(grid, "VerticalAlignment").unwrap_or("Top");
    let start_x = align_offset(content.width, g.block_w, h_align);
    let start_y = align_offset(content.height, g.block_h, v_align);

    for (i, &(idx, child)) in order.iter().enumerate() {
        let line = i / g.per_line; // which row (horizontal) / column (vertical)
        let within = i % g.per_line; // position along the fill direction
        let (col, row) = if g.vertical {
            (line, within)
        } else {
            (within, line)
        };
        let x = content.x + start_x + col as f64 * (g.cell_w + g.pad_x);
        let y = content.y + start_y + row as f64 * (g.cell_h + g.pad_y);
        let rect = Rect {
            x,
            y,
            width: g.cell_w,
            height: g.cell_h,
        };
        place_node(child, rect, format!("{parent_path}/{idx}"), out)?;
    }
    Ok(())
}

// --- placement ---------------------------------------------------------------

/// Resolve a free-positioned child's rect (size + anchor/position).
fn child_rect(node: &SceneNode, parent_content: Rect) -> Rect {
    let (w, h) = resolve_size(node, parent_content);
    let pos = node.position();
    let anchor = node.anchor_point();
    Rect {
        x: parent_content.x + resolve_axis(pos.x, parent_content.width) - anchor.x * w,
        y: parent_content.y + resolve_axis(pos.y, parent_content.height) - anchor.y * h,
        width: w,
        height: h,
    }
}

/// Place `node` at the already-resolved `rect`, store it, then lay out children.
fn place_node(
    node: &SceneNode,
    rect: Rect,
    path: String,
    out: &mut BTreeMap<String, LayoutNode>,
) -> Result<(), LayoutError> {
    let id = node.id.clone().unwrap_or_else(|| path.clone());
    if out.contains_key(&id) {
        return Err(LayoutError::DuplicateId(id));
    }
    out.insert(id, LayoutNode { rect });

    let content = content_box(node, rect);
    let children = layout_children(node);

    if let Some(list) = find_modifier(node, "UIListLayout") {
        place_with_list(content, list, &children, &path, out)?;
    } else if let Some(grid) = find_modifier(node, "UIGridLayout") {
        place_with_grid(content, grid, &children, &path, out)?;
    } else {
        for &(idx, child) in &children {
            let r = child_rect(child, content);
            place_node(child, r, format!("{path}/{idx}"), out)?;
        }
    }
    Ok(())
}

/// Compute absolute rects for a Roblox GUI tree. The `root` node always fills the
/// viewport regardless of its className/properties.
pub fn compute_layout(root: &SceneNode, viewport: Viewport) -> Result<LayoutResult, LayoutError> {
    let mut rects = BTreeMap::new();
    let vp_rect = Rect {
        x: 0.0,
        y: 0.0,
        width: viewport.width,
        height: viewport.height,
    };
    place_node(root, vp_rect, "0".to_string(), &mut rects)?;
    Ok(LayoutResult { rects })
}

#[cfg(test)]
mod tests {
    use super::*;
    use loom_scene::{EnumItem, KnownProperty, PropertyValue, UDim, UDim2, Vector2};

    fn udim2(sx: f64, ox: f64, sy: f64, oy: f64) -> PropertyValue {
        PropertyValue::Known(KnownProperty::UDim2(UDim2 {
            x: UDim {
                scale: sx,
                offset: ox,
            },
            y: UDim {
                scale: sy,
                offset: oy,
            },
        }))
    }
    fn vector2(x: f64, y: f64) -> PropertyValue {
        PropertyValue::Known(KnownProperty::Vector2(Vector2 { x, y }))
    }
    fn udim(scale: f64, offset: f64) -> PropertyValue {
        PropertyValue::Known(KnownProperty::UDim(UDim { scale, offset }))
    }
    fn num(v: f64) -> PropertyValue {
        PropertyValue::Known(KnownProperty::Number(v))
    }
    fn int(v: i64) -> PropertyValue {
        PropertyValue::Known(KnownProperty::Int(v))
    }
    fn enum_item(enum_type: &str, name: &str) -> PropertyValue {
        PropertyValue::Known(KnownProperty::EnumItem(EnumItem {
            enum_type: enum_type.into(),
            name: name.into(),
            value: 0.0,
        }))
    }
    fn frame(name: &str) -> SceneNode {
        SceneNode::new("Frame", name)
    }
    fn with(class: &str, name: &str, props: &[(&str, PropertyValue)]) -> SceneNode {
        let mut n = SceneNode::new(class, name);
        for (k, v) in props {
            n.properties.insert((*k).into(), v.clone());
        }
        n
    }
    fn screen(children: Vec<SceneNode>) -> SceneNode {
        let mut root = SceneNode::new("ScreenGui", "App");
        root.children = children;
        root
    }

    const VP: Viewport = Viewport {
        width: 800.0,
        height: 600.0,
    };

    #[test]
    fn worked_example_matches_roblox() {
        let f = with(
            "Frame",
            "Panel",
            &[
                ("Size", udim2(0.5, 0.0, 0.0, 40.0)),
                ("Position", udim2(0.0, 10.0, 0.0, 10.0)),
                ("AnchorPoint", vector2(0.5, 0.0)),
            ],
        );
        let r = compute_layout(&screen(vec![f]), VP).unwrap();
        assert_eq!(
            r.rects["0/0"].rect,
            Rect {
                x: -190.0,
                y: 10.0,
                width: 400.0,
                height: 40.0
            }
        );
    }

    #[test]
    fn root_fills_viewport_even_for_non_screengui() {
        let mut root = frame("Root");
        root.properties
            .insert("Size".into(), udim2(0.0, 100.0, 0.0, 100.0));
        let r = compute_layout(
            &root,
            Viewport {
                width: 1280.0,
                height: 720.0,
            },
        )
        .unwrap();
        assert_eq!(r.rects["0"].rect.width, 1280.0);
        assert_eq!(r.rects["0"].rect.height, 720.0);
    }

    #[test]
    fn duplicate_explicit_id_is_rejected() {
        let mut a = frame("A");
        a.id = Some("dup".into());
        let mut b = frame("B");
        b.id = Some("dup".into());
        let err = compute_layout(&screen(vec![a, b]), VP).unwrap_err();
        assert_eq!(err, LayoutError::DuplicateId("dup".into()));
    }

    #[test]
    fn ui_padding_insets_the_content_box() {
        let pad = with(
            "UIPadding",
            "Pad",
            &[
                ("PaddingLeft", udim(0.0, 20.0)),
                ("PaddingRight", udim(0.0, 20.0)),
                ("PaddingTop", udim(0.0, 10.0)),
                ("PaddingBottom", udim(0.0, 10.0)),
            ],
        );
        let inner = with("Frame", "Inner", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]);
        let mut padded = with("Frame", "Padded", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]);
        padded.children = vec![pad, inner];
        let r = compute_layout(&screen(vec![padded]), VP).unwrap();
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 20.0,
                y: 10.0,
                width: 760.0,
                height: 580.0
            }
        );
    }

    #[test]
    fn ui_list_layout_stacks_vertically_with_padding() {
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Vertical")),
                ("Padding", udim(0.0, 10.0)),
            ],
        );
        let mut container = with("Frame", "Container", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]);
        container.children.push(list);
        for name in ["A", "B", "C"] {
            container.children.push(with(
                "Frame",
                name,
                &[("Size", udim2(0.0, 100.0, 0.0, 40.0))],
            ));
        }
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 40.0
            }
        );
        assert_eq!(
            r.rects["0/0/1"].rect,
            Rect {
                x: 0.0,
                y: 50.0,
                width: 100.0,
                height: 40.0
            }
        );
        assert_eq!(
            r.rects["0/0/2"].rect,
            Rect {
                x: 0.0,
                y: 100.0,
                width: 100.0,
                height: 40.0
            }
        );
    }

    #[test]
    fn ui_list_skips_invisible_children() {
        // Roblox UIListLayout ignores `Visible = false` siblings: they reserve no
        // slot, so the items after a hidden one pack up against the visible ones.
        // (Regression: a hidden middle item used to leave a gap, pushing the rest
        // down — which floated a filtered combobox's sole match to the bottom.)
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Vertical")),
                ("Padding", udim(0.0, 10.0)),
            ],
        );
        let mut container = with("Frame", "Container", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]);
        container.children.push(list);
        for (name, visible) in [("A", true), ("B", false), ("C", true)] {
            container.children.push(with(
                "Frame",
                name,
                &[
                    ("Size", udim2(0.0, 100.0, 0.0, 40.0)),
                    ("Visible", PropertyValue::Known(KnownProperty::Bool(visible))),
                ],
            ));
        }
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // A sits at the top.
        assert_eq!(r.rects["0/0/0"].rect.y, 0.0);
        // C packs directly below A (y = 40 + 10 gap), NOT at 100 — the hidden B
        // consumed no slot.
        assert_eq!(r.rects["0/0/2"].rect.y, 50.0);
        // B still gets a rect (the renderer hides it via CSS) but takes no space.
        assert_eq!(r.rects["0/0/1"].rect.y, 50.0);
    }

    #[test]
    fn ui_list_center_alignment_and_layout_order() {
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Vertical")),
                (
                    "HorizontalAlignment",
                    enum_item("HorizontalAlignment", "Center"),
                ),
            ],
        );
        let mut container = with("Frame", "Container", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]);
        container.children.push(list);
        container.children.push(with(
            "Frame",
            "A",
            &[
                ("Size", udim2(0.0, 200.0, 0.0, 50.0)),
                ("LayoutOrder", int(2)),
            ],
        ));
        container.children.push(with(
            "Frame",
            "B",
            &[
                ("Size", udim2(0.0, 200.0, 0.0, 50.0)),
                ("LayoutOrder", int(1)),
            ],
        ));
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // x centered = (800-200)/2 = 300; B (order 1) first -> y 0, A -> y 50; ids positional.
        assert_eq!(
            r.rects["0/0/1"].rect,
            Rect {
                x: 300.0,
                y: 0.0,
                width: 200.0,
                height: 50.0
            }
        );
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 300.0,
                y: 50.0,
                width: 200.0,
                height: 50.0
            }
        );
    }

    #[test]
    fn aspect_ratio_constraint_derives_height_from_width() {
        let arc = with(
            "UIAspectRatioConstraint",
            "AR",
            &[("AspectRatio", num(2.0))],
        );
        let mut f = with("Frame", "F", &[("Size", udim2(0.0, 200.0, 0.0, 999.0))]);
        f.children.push(arc);
        let r = compute_layout(&screen(vec![f]), VP).unwrap();
        // DominantAxis Width default: height = width / ratio = 200 / 2 = 100.
        assert_eq!(r.rects["0/0"].rect.width, 200.0);
        assert_eq!(r.rects["0/0"].rect.height, 100.0);
    }

    #[test]
    fn size_constraint_clamps_min_and_max() {
        let sc = with(
            "UISizeConstraint",
            "SC",
            &[
                ("MaxSize", vector2(300.0, 300.0)),
                ("MinSize", vector2(50.0, 50.0)),
            ],
        );
        let mut big = with("Frame", "Big", &[("Size", udim2(0.0, 500.0, 0.0, 10.0))]);
        big.children.push(sc);
        let r = compute_layout(&screen(vec![big]), VP).unwrap();
        // width clamped 500 -> 300; height raised 10 -> 50.
        assert_eq!(r.rects["0/0"].rect.width, 300.0);
        assert_eq!(r.rects["0/0"].rect.height, 50.0);
    }

    #[test]
    fn automatic_size_grows_to_vertical_list_content() {
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Vertical")),
                ("Padding", udim(0.0, 10.0)),
            ],
        );
        // Fixed width 300, AutomaticSize Y.
        let mut container = with(
            "Frame",
            "Container",
            &[
                ("Size", udim2(0.0, 300.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        container.children.push(list);
        for name in ["A", "B", "C"] {
            container
                .children
                .push(with("Frame", name, &[("Size", udim2(1.0, 0.0, 0.0, 40.0))]));
        }
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // height = 40*3 + 10*2 = 140; width stays 300.
        assert_eq!(
            r.rects["0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 140.0
            }
        );
        // Children fill the 300 width and stack.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 40.0
            }
        );
        assert_eq!(r.rects["0/0/2"].rect.y, 100.0);
    }

    #[test]
    fn automatic_size_treats_size_as_a_minimum() {
        // Roblox does not let AutomaticSize shrink an element below its own
        // `Size` — the property is the floor, and the content only grows past
        // it. A 200-wide container holding a 50-wide child stays 200.
        let mut container = with(
            "Frame",
            "Container",
            &[
                ("Size", udim2(0.0, 200.0, 0.0, 120.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        container.children.push(with(
            "Frame",
            "Child",
            &[("Size", udim2(0.0, 50.0, 0.0, 40.0))],
        ));
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 200.0);
        assert_eq!(r.rects["0/0"].rect.height, 120.0);

        // …and content larger than `Size` still wins on both axes.
        let mut grown = with(
            "Frame",
            "Container",
            &[
                ("Size", udim2(0.0, 200.0, 0.0, 120.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        grown.children.push(with(
            "Frame",
            "Child",
            &[("Size", udim2(0.0, 260.0, 0.0, 300.0))],
        ));
        let r = compute_layout(&screen(vec![grown]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 260.0);
        assert_eq!(r.rects["0/0"].rect.height, 300.0);
    }

    #[test]
    fn automatic_size_free_children_bounding_box() {
        let a = with(
            "Frame",
            "A",
            &[
                ("Size", udim2(0.0, 80.0, 0.0, 30.0)),
                ("Position", udim2(0.0, 10.0, 0.0, 10.0)),
            ],
        );
        let b = with(
            "Frame",
            "B",
            &[
                ("Size", udim2(0.0, 50.0, 0.0, 50.0)),
                ("Position", udim2(0.0, 120.0, 0.0, 5.0)),
            ],
        );
        let mut container = with(
            "Frame",
            "Container",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        container.children = vec![a, b];
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // bounding box: width = max(10+80, 120+50)=170; height = max(10+30, 5+50)=55.
        assert_eq!(r.rects["0/0"].rect.width, 170.0);
        assert_eq!(r.rects["0/0"].rect.height, 55.0);
    }

    #[test]
    fn grid_layout_wraps_into_rows() {
        // content 800 wide; cell 100, pad 20 -> per row floor((800+20)/120)=6.
        let grid = with(
            "UIGridLayout",
            "Grid",
            &[
                ("CellSize", udim2(0.0, 100.0, 0.0, 100.0)),
                ("CellPadding", udim2(0.0, 20.0, 0.0, 20.0)),
            ],
        );
        let mut container = with("Frame", "Container", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]);
        container.children.push(grid);
        for i in 0..8 {
            container.children.push(frame(&format!("Cell{i}")));
        }
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // Cell 0 at (0,0); cell 5 at col 5 -> x=5*120=600; cell 6 wraps to row 1 -> (0,120).
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0
            }
        );
        assert_eq!(
            r.rects["0/0/5"].rect,
            Rect {
                x: 600.0,
                y: 0.0,
                width: 100.0,
                height: 100.0
            }
        );
        assert_eq!(
            r.rects["0/0/6"].rect,
            Rect {
                x: 0.0,
                y: 120.0,
                width: 100.0,
                height: 100.0
            }
        );
    }

    #[test]
    fn scrolling_frame_lays_children_against_canvas() {
        // Window 800x600; CanvasSize {0,800},{0,1200}. A child at scale y=1 -> 1200 tall.
        let mut scroll = with(
            "ScrollingFrame",
            "Scroll",
            &[
                ("Size", udim2(1.0, 0.0, 1.0, 0.0)),
                ("CanvasSize", udim2(0.0, 800.0, 0.0, 1200.0)),
            ],
        );
        scroll.children.push(with(
            "Frame",
            "Tall",
            &[("Size", udim2(1.0, 0.0, 1.0, 0.0))],
        ));
        let r = compute_layout(&screen(vec![scroll]), VP).unwrap();
        // Child fills the canvas (1200 tall), exceeding the 600 window (renderer clips).
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 800.0,
                height: 1200.0
            }
        );
    }

    #[test]
    fn auto_size_with_scale_padding_stays_consistent() {
        // Scale UIPadding on the auto (Y) axis is treated offset-only in BOTH the
        // measurement and the content box, so the child never overflows the grown box.
        let pad = with(
            "UIPadding",
            "Pad",
            &[
                ("PaddingTop", udim(0.1, 0.0)),
                ("PaddingBottom", udim(0.1, 0.0)),
            ],
        );
        let child = with("Frame", "Child", &[("Size", udim2(0.0, 200.0, 0.0, 80.0))]);
        let mut container = with(
            "Frame",
            "Container",
            &[
                ("Size", udim2(0.0, 300.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        container.children = vec![pad, child];
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // Container grows by content only (scale padding -> 0); child fits exactly.
        assert_eq!(r.rects["0/0"].rect.height, 80.0);
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 200.0,
                height: 80.0
            }
        );
    }

    #[test]
    fn grid_auto_size_grows_along_fill_axis_as_single_row() {
        let grid = with(
            "UIGridLayout",
            "Grid",
            &[
                ("CellSize", udim2(0.0, 100.0, 0.0, 100.0)),
                ("CellPadding", udim2(0.0, 10.0, 0.0, 10.0)),
            ],
        );
        let mut container = with(
            "Frame",
            "Container",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        container.children.push(grid);
        for i in 0..4 {
            container.children.push(frame(&format!("Cell{i}")));
        }
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // Single row: width = 4*100 + 3*10 = 430, height = 100. Cells along x.
        assert_eq!(
            r.rects["0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 430.0,
                height: 100.0
            }
        );
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0
            }
        );
        assert_eq!(
            r.rects["0/0/3"].rect,
            Rect {
                x: 330.0,
                y: 0.0,
                width: 100.0,
                height: 100.0
            }
        );
    }

    #[test]
    fn empty_auto_grid_collapses_to_zero() {
        let grid = with(
            "UIGridLayout",
            "Grid",
            &[("CellSize", udim2(0.0, 100.0, 0.0, 100.0))],
        );
        let mut container = with(
            "Frame",
            "Container",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        container.children.push(grid);
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 0.0);
        assert_eq!(r.rects["0/0"].rect.height, 0.0);
    }

    #[test]
    fn auto_size_free_child_honors_anchor_point() {
        // child at Position {0,100},{0,60} AnchorPoint {1,1}: top-left = (0, 10);
        // extent = (100, 60), NOT (200, 110).
        let child = with(
            "Frame",
            "Child",
            &[
                ("Size", udim2(0.0, 100.0, 0.0, 50.0)),
                ("Position", udim2(0.0, 100.0, 0.0, 60.0)),
                ("AnchorPoint", vector2(1.0, 1.0)),
            ],
        );
        let mut container = with(
            "Frame",
            "Container",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        container.children.push(child);
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 100.0);
        assert_eq!(r.rects["0/0"].rect.height, 60.0);
    }

    /// A 600-wide row of three 100-wide items: 300px of it is leftover space,
    /// which is what every flex value below divides up.
    fn flex_row(flex_property: &str, flex_value: &str) -> LayoutResult {
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Horizontal")),
                (flex_property, enum_item("UIFlexAlignment", flex_value)),
            ],
        );
        let item = |name: &str| with("Frame", name, &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]);
        let mut row = with("Frame", "Row", &[("Size", udim2(0.0, 600.0, 0.0, 200.0))]);
        row.children = vec![list, item("A"), item("B"), item("C")];
        compute_layout(&screen(vec![row]), VP).unwrap()
    }

    #[test]
    fn horizontal_flex_space_between_pushes_the_ends_apart() {
        let r = flex_row("HorizontalFlex", "SpaceBetween");
        // First flush left, last flush right, 150px of air between each pair.
        assert_eq!(r.rects["0/0/0"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 250.0);
        assert_eq!(r.rects["0/0/2"].rect.x, 500.0);
    }

    #[test]
    fn horizontal_flex_space_evenly_pads_every_gap_equally() {
        let r = flex_row("HorizontalFlex", "SpaceEvenly");
        // Four 75px gaps: before, between, between, after.
        assert_eq!(r.rects["0/0/0"].rect.x, 75.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 250.0);
        assert_eq!(r.rects["0/0/2"].rect.x, 425.0);
    }

    #[test]
    fn horizontal_flex_space_around_halves_the_outer_gaps() {
        let r = flex_row("HorizontalFlex", "SpaceAround");
        // 100px per item, split half before and half after each.
        assert_eq!(r.rects["0/0/0"].rect.x, 50.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 250.0);
        assert_eq!(r.rects["0/0/2"].rect.x, 450.0);
    }

    #[test]
    fn horizontal_flex_fill_grows_every_item() {
        let r = flex_row("HorizontalFlex", "Fill");
        for (id, x) in [("0/0/0", 0.0), ("0/0/1", 200.0), ("0/0/2", 400.0)] {
            assert_eq!(r.rects[id].rect.x, x);
            assert_eq!(r.rects[id].rect.width, 200.0);
        }
    }

    #[test]
    fn cross_axis_flex_fill_stretches_instead_of_spacing() {
        // VerticalFlex on a horizontal list is the cross axis: only Fill applies,
        // and it stretches each item over the row's height rather than moving it.
        let r = flex_row("VerticalFlex", "Fill");
        assert_eq!(r.rects["0/0/0"].rect.height, 200.0);
        assert_eq!(r.rects["0/0/0"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 100.0);
    }

    #[test]
    fn cross_axis_space_values_are_ignored() {
        let r = flex_row("VerticalFlex", "SpaceBetween");
        assert_eq!(r.rects["0/0/0"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 100.0);
        assert_eq!(r.rects["0/0/0"].rect.height, 50.0);
    }

    #[test]
    fn flex_never_spaces_when_the_row_is_full() {
        // No leftover space => alignment still decides, nothing to distribute.
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Horizontal")),
                (
                    "HorizontalFlex",
                    enum_item("UIFlexAlignment", "SpaceBetween"),
                ),
            ],
        );
        let item = |name: &str| with("Frame", name, &[("Size", udim2(0.0, 300.0, 0.0, 50.0))]);
        let mut row = with("Frame", "Row", &[("Size", udim2(0.0, 600.0, 0.0, 200.0))]);
        row.children = vec![list, item("A"), item("B")];
        let r = compute_layout(&screen(vec![row]), VP).unwrap();
        assert_eq!(r.rects["0/0/0"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 300.0);
    }

    #[test]
    fn ui_flex_item_grows_only_the_marked_child() {
        let list = with(
            "UIListLayout",
            "List",
            &[("FillDirection", enum_item("FillDirection", "Horizontal"))],
        );
        let mut grower = with("Frame", "Grow", &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]);
        grower.children = vec![with(
            "UIFlexItem",
            "Flex",
            &[("FlexMode", enum_item("UIFlexMode", "Fill"))],
        )];
        let mut row = with("Frame", "Row", &[("Size", udim2(0.0, 600.0, 0.0, 200.0))]);
        row.children = vec![
            list,
            with("Frame", "Fixed", &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]),
            grower,
        ];
        let r = compute_layout(&screen(vec![row]), VP).unwrap();
        assert_eq!(r.rects["0/0/0"].rect.width, 100.0);
        // The marked child swallows all 400px of leftover space.
        assert_eq!(r.rects["0/0/1"].rect.x, 100.0);
        assert_eq!(r.rects["0/0/1"].rect.width, 500.0);
    }

    #[test]
    fn invisible_children_do_not_get_flex_space() {
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Horizontal")),
                (
                    "HorizontalFlex",
                    enum_item("UIFlexAlignment", "SpaceBetween"),
                ),
            ],
        );
        let item = |name: &str| with("Frame", name, &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]);
        let mut hidden = item("Hidden");
        hidden.properties.insert(
            "Visible".into(),
            PropertyValue::Known(KnownProperty::Bool(false)),
        );
        let mut row = with("Frame", "Row", &[("Size", udim2(0.0, 600.0, 0.0, 200.0))]);
        row.children = vec![list, item("A"), hidden, item("B")];
        let r = compute_layout(&screen(vec![row]), VP).unwrap();
        // Two visible items => one 400px gap; the hidden one takes no slot.
        assert_eq!(r.rects["0/0/0"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/2"].rect.x, 500.0);
    }

    #[test]
    fn auto_size_text_uses_injected_text_bounds() {
        // A text class with AutomaticSize XY and no children grows to its TextBounds
        // (a Vector2 the adapter measures browser-side and injects).
        let label = with(
            "TextLabel",
            "Label",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
                ("TextBounds", vector2(118.0, 18.0)),
            ],
        );
        let r = compute_layout(&screen(vec![label]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 118.0);
        assert_eq!(r.rects["0/0"].rect.height, 18.0);
    }
}
