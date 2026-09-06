//! Loom layout engine (pure Rust, native-testable).
//!
//! Computes an absolute pixel [`Rect`] for every layout-participating node in a
//! [`SceneNode`] tree, given a [`Viewport`]. Origin is top-left, y-down
//! (DOM-aligned). All math is f64.
//!
//! Roblox semantics implemented here:
//! - Own size: `Size` UDim2 -> resolve -> `UIAspectRatioConstraint` -> `UISizeConstraint`
//!   clamp -> `AutomaticSize` grow-to-content. Then `AnchorPoint`/`Position` place it.
//! - `UIPadding` insets the content box; `UIListLayout`/`UIGridLayout`/`UITableLayout`/
//!   `UIPageLayout` flow children (ignoring their Position/AnchorPoint);
//!   `ScrollingFrame` lays children out against its `CanvasSize`, and is the one
//!   container that does not cap their `AutomaticSize` at its own box — content
//!   taller (or wider) than the window is what there is to scroll.
//! - `UIScale` multiplies the size of the object it is parented to *and* of
//!   everything under it — child offsets, padding and layout gaps alike — so the
//!   subtree renders `Scale` times bigger about that object's own top-left. It
//!   never moves the object itself: the position its parent gave it stands.
//! - The TOP node always fills the viewport, regardless of className.
//! - Non-layout modifier children get no rect and do not advance the positional id.
//!
//! Deferred (documented): `UIPageLayout` animation (`Animated`/`TweenTime`/`Circular`
//! wrap-around placement — the layout is always the settled state),
//! f32 pixel-snapping parity, `SizeConstraint` axis modes, grid `StartCorner` variants,
//! `AspectType: ScaleWithParentSize`, `CanvasPosition`/scroll offset, `ScrollBarThickness`
//! (the scrollbar-reserved `AbsoluteWindowSize`), `AutomaticSize` combined with an explicit
//! `CanvasSize` on a `ScrollingFrame`, scale `UIPadding` on an `AutomaticSize` axis
//! (treated as offset-only so measurement and placement agree), and a `UIScale` on a
//! node whose extent its *container* assigns rather than the node resolving it — a
//! `UIGridLayout` cell, a `UITableLayout` track or line, a flex `Fill` cross axis.
//! The rule here is that a `UIScale` multiplies the size a node resolves for itself
//! (`resolve_size`), which is every free-placed, list-flowed and page node; where a
//! container hands down an extent instead, that extent stands and only what is
//! *inside* the scaled node grows. Which of the two the engine does was not
//! verifiable without a running Studio, and guessing would have been worse than
//! saying so.

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

/// Slack for "does this still fit?" comparisons, so a row whose items sum to
/// exactly the container width doesn't wrap its last item on a float rounding
/// error a fraction of a pixel wide.
const EPS: f64 = 1e-6;

/// A `UDim` against a parent extent, in real pixels.
///
/// `u.scale` needs no conversion — it resolves against a parent extent that is
/// already scaled — but `u.offset` is a raw scene number, so it is worth `unit`
/// real pixels apiece (see [`own_scale`]).
#[inline]
fn resolve_axis(u: UDim, parent_axis_px: f64, unit: f64) -> f64 {
    parent_axis_px * u.scale + u.offset * unit
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

/// An enum property's item name, from either spelling the engine accepts.
///
/// Roblox coerces a bare string on an enum property — `FlexMode = "Custom"` is
/// `Enum.UIFlexMode.Custom` — and roblox-ts types it that way, so component
/// libraries pass strings through freely (`valign="Center"`, `mode="Custom"`,
/// `align="Right"`). Reading only the `EnumItem` form made every one of those a
/// silent no-op: a `UIFlexItem` written with a string `FlexMode` took no share
/// of the row, and the control it wrapped came out zero wide.
fn enum_name<'a>(node: &'a SceneNode, key: &str) -> Option<&'a str> {
    let prop = node.properties.get(key)?;
    if let Some(item) = prop.as_enum() {
        return Some(item.name.as_str());
    }
    prop.as_str().filter(|name| !name.is_empty())
}

/// Aligned start offset of a block of `block` px within `space` px.
fn align_offset(space: f64, block: f64, align: &str) -> f64 {
    match align {
        "Center" => (space - block) / 2.0,
        "Right" | "Bottom" => space - block,
        _ => 0.0, // Left / Top
    }
}

// --- UIScale -----------------------------------------------------------------

/// The multiplier a node's own `UIScale` child puts on it — 1.0 when it has none,
/// which is also the engine's default `Scale`.
///
/// A `UIScale` scales the GuiObject it is parented to along with every descendant:
/// `Scale = 2` on a card doubles the card, its `UIPadding`, its `UIListLayout`
/// gaps and every offset underneath, so the whole subtree renders twice as big
/// about the card's top-left. It is the standard way an app scales its UI to the
/// viewport, and the standard hover "pop" (a tween on `Scale`) — both of which
/// need the object itself to grow, not only its contents.
///
/// Scales nest multiplicatively: a 1.5 inside a 2 renders at 3. That running
/// product is what travels down this file as `unit` — "how many real pixels one
/// scene `Offset` pixel is worth here". It is threaded as its own parameter
/// rather than folded into [`Limits`] because every ceiling in this file is
/// already in real pixels; only the raw offsets a scene carries need converting.
/// `unit` and not `scale` because `UDim::scale` — the fraction-of-parent
/// component — sits right next to it in these expressions and the two are not
/// the same thing.
///
/// A negative `Scale` has no meaning for a box with a width, so it clamps to 0
/// and collapses the subtree the way `Scale = 0` does.
fn own_scale(node: &SceneNode) -> f64 {
    find_modifier(node, "UIScale")
        .and_then(|s| num_prop(s, "Scale"))
        .unwrap_or(1.0)
        .max(0.0)
}

// --- own size: constraints + automatic size ----------------------------------

/// The room a node's parent leaves it on each axis — the ceiling `AutomaticSize`
/// grows against.
///
/// Roblox bounds it: an object with `AutomaticSize` on an axis "will increase in
/// size up to maximum size allowed by the parent", and a `TextWrapped` label
/// resizes "until the maximum extent is reached (parent's max size)" and only
/// *then* starts wrapping. Growing unbounded instead lets a card whose content
/// has an irreducible minimum — a row of buttons, a long word — run out of the
/// container that positions it and paint over its neighbour, which is the one
/// thing a `45%` column can never do in the engine.
///
/// `None` on an axis means there is no ceiling yet: the parent is itself being
/// measured on it, so its width is the thing being computed and clamping to the
/// zero-wide measurement box would collapse the whole subtree. Measurement is
/// then CSS `max-content`, and the real ceiling arrives on the placement pass.
#[derive(Clone, Copy, Debug)]
struct Limits {
    x: Option<f64>,
    y: Option<f64>,
}

impl Limits {
    /// A parent whose rect is final: both axes are a real ceiling.
    fn definite(width: f64, height: f64) -> Self {
        Limits {
            x: Limits::room(width),
            y: Limits::room(height),
        }
    }

    /// A measurement as a ceiling — `None` once there is no room left to speak
    /// of.
    ///
    /// A box with nothing on an axis does not mean "everything inside you is
    /// zero": a container laid out `Size={fromScale(1, 0)} AutomaticSize={Y}`
    /// has no width of its own until its parent gives it one, and a dropdown
    /// positioned from a ref is 0 wide on the render before the ref resolves.
    /// The engine lets what is inside overflow such a box rather than
    /// collapsing it, and so does the rest of this file — `grid_metrics` reads
    /// a `line_len <= 0` fill axis as unconstrained, and `content_box` ignores
    /// a zero `CanvasSize`.
    fn room(size: f64) -> Option<f64> {
        if size > 0.0 {
            Some(size)
        } else {
            None
        }
    }

    /// `value`, never past the ceiling — `value` itself when there isn't one.
    fn cap(limit: Option<f64>, value: f64) -> f64 {
        match limit {
            Some(max) => value.min(max),
            None => value,
        }
    }

    /// The ceiling that survives `pad` px of padding on the way in.
    fn inset(limit: Option<f64>, pad: f64) -> Option<f64> {
        limit.and_then(|max| Limits::room(max - pad))
    }
}

/// `(auto_x, auto_y)` from `AutomaticSize`.
fn automatic_axes(node: &SceneNode) -> (bool, bool) {
    match enum_name(node, "AutomaticSize") {
        Some("X") => (true, false),
        Some("Y") => (false, true),
        Some("XY") => (true, true),
        _ => (false, false),
    }
}

/// `(auto_x, auto_y)` from a `ScrollingFrame`'s `AutomaticCanvasSize` — the axes
/// on which the canvas grows to whatever the content turns out to be.
fn automatic_canvas_axes(node: &SceneNode) -> (bool, bool) {
    match enum_name(node, "AutomaticCanvasSize") {
        Some("X") => (true, false),
        Some("Y") => (false, true),
        Some("XY") => (true, true),
        _ => (false, false),
    }
}

/// The ceiling a container's content box puts on its children (see [`Limits`]).
///
/// Every container is that ceiling — except a `ScrollingFrame` on an axis whose
/// canvas is not a fixed extent, where outgrowing the window is the entire
/// point. The Roblox idiom for a scrolling list is an `AutomaticSize` column
/// inside an `AutomaticCanvasSize` frame; capping the column at the window makes
/// the canvas exactly the window, so nothing ever overflows, nothing scrolls,
/// and no scroll bar is ever drawn — a scrolling frame that silently stops
/// being one.
///
/// An axis is capped only when `CanvasSize` gives it an extent of its own that
/// `AutomaticCanvasSize` is not free to grow. A zero `CanvasSize` axis is not a
/// zero-high box to squeeze the content into — [`content_box`] already reads it
/// as "no canvas, fall back to the window" — so it leaves no ceiling either.
fn content_limits(node: &SceneNode, rect: Rect, content: Rect, inner: f64) -> Limits {
    if node.class_name != "ScrollingFrame" {
        return Limits::definite(content.width, content.height);
    }
    let canvas = node
        .properties
        .get("CanvasSize")
        .and_then(PropertyValue::as_udim2);
    let (auto_x, auto_y) = automatic_canvas_axes(node);
    let canvas_w = canvas.map_or(0.0, |cs| resolve_axis(cs.x, rect.width, inner));
    let canvas_h = canvas.map_or(0.0, |cs| resolve_axis(cs.y, rect.height, inner));
    Limits {
        x: if auto_x || canvas_w <= 0.0 {
            None
        } else {
            Limits::room(content.width)
        },
        y: if auto_y || canvas_h <= 0.0 {
            None
        } else {
            Limits::room(content.height)
        },
    }
}

/// Padding insets `(left, right, top, bottom)` from a `UIPadding` child, resolved
/// against `(w, h)`. On an AutomaticSize axis, scale padding is resolved against 0
/// (offset only) so the auto-size measurement and the placement content box agree
/// — a scale-padded auto axis is otherwise circular. The single shared reader for
/// both `resolve_size` and `content_box` so they can never diverge.
///
/// The insets live inside the node, so `inner` is the node's own scale already
/// folded in (see [`own_scale`]): a 12px inset in a doubled card is 24 real px,
/// the same as everything else the card holds.
fn padding_insets(node: &SceneNode, w: f64, h: f64, inner: f64) -> (f64, f64, f64, f64) {
    let Some(pad) = find_modifier(node, "UIPadding") else {
        return (0.0, 0.0, 0.0, 0.0);
    };
    let (ax, ay) = automatic_axes(node);
    let xref = if ax { 0.0 } else { w };
    let yref = if ay { 0.0 } else { h };
    let l = udim_prop(pad, "PaddingLeft").map_or(0.0, |u| resolve_axis(u, xref, inner));
    let r = udim_prop(pad, "PaddingRight").map_or(0.0, |u| resolve_axis(u, xref, inner));
    let t = udim_prop(pad, "PaddingTop").map_or(0.0, |u| resolve_axis(u, yref, inner));
    let b = udim_prop(pad, "PaddingBottom").map_or(0.0, |u| resolve_axis(u, yref, inner));
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
///
/// The bounds are pixel numbers like any other, so under a `UIScale` they clamp
/// at `unit`-scaled pixels — a 100px floor inside a doubled card is 200 real px,
/// which is what keeps the subtree uniformly scaled instead of the constrained
/// box alone staying its original size. The node's *own* `UIScale` multiplies
/// after the clamp (see [`resolve_size`]): the constraint bounds the size the
/// object asks for, so a button that pops to 1.1x on hover still pops even with
/// a `MaxSize` pinning its resting width.
fn apply_size_constraint(node: &SceneNode, w: f64, h: f64, unit: f64) -> (f64, f64) {
    let Some(sc) = find_modifier(node, "UISizeConstraint") else {
        return (w, h);
    };
    let min = vec2_prop(sc, "MinSize").unwrap_or(Vector2 { x: 0.0, y: 0.0 });
    let mut w = w.max(min.x * unit);
    let mut h = h.max(min.y * unit);
    if let Some(max) = vec2_prop(sc, "MaxSize") {
        w = w.min(max.x * unit);
        h = h.min(max.y * unit);
    }
    (w, h)
}

/// Size from the `Size` UDim2 plus aspect-ratio and min/max constraints (before
/// AutomaticSize, and before the node's own `UIScale`).
fn base_size(node: &SceneNode, parent: Rect, unit: f64) -> (f64, f64) {
    let s = node.size();
    let w = resolve_axis(s.x, parent.width, unit).max(0.0);
    let h = resolve_axis(s.y, parent.height, unit).max(0.0);
    let (w, h) = apply_aspect_ratio(node, w, h);
    apply_size_constraint(node, w, h, unit)
}

/// Final resolved `(width, height)` of a node: base size grown by AutomaticSize,
/// never past the room `limit` says its parent has (see [`Limits`]).
///
/// `unit` is the scale of the space the node is placed in — its parent's inner
/// scale. Its own `UIScale` multiplies on top of that, and everything it holds
/// is measured at the product.
fn resolve_size(node: &SceneNode, parent: Rect, limit: Limits, unit: f64) -> (f64, f64) {
    // The node's own `UIScale` is a multiplier on the size it just resolved, not
    // only on what is inside it — that is what makes a `Scale` tween grow the
    // button it sits on. The `Size` scale component is multiplied too: the
    // engine scales the object's rendered extent, so a `fromScale(1, 1)` panel
    // under `Scale = 2` renders at twice its parent and overflows it.
    let own = own_scale(node);
    let inner = unit * own;
    let (bw, bh) = base_size(node, parent, unit);
    let (w, h) = (bw * own, bh * own);
    let (mut ax, mut ay) = automatic_axes(node);
    // A scale size against a parent axis that has no size *yet* is not zero.
    // `Size={fromScale(1, 0)}` inside an auto-sizing parent is the library idiom
    // for "as wide as whatever ends up holding me", and the chain is circular:
    // the parent is waiting on this node's content and this node is waiting on
    // the parent. The engine settles it on the content — a `fromScale(1, 0)`
    // control inside an auto-sized row comes out the width of its own text, not
    // nothing — so the axis behaves as automatic here. Resolving it to zero
    // instead collapsed the node and everything under it.
    let s = node.size();
    if !ax && s.x.scale > 0.0 && parent.width <= 0.0 {
        ax = true;
    }
    if !ay && s.y.scale > 0.0 && parent.height <= 0.0 {
        ay = true;
    }
    if !ax && !ay {
        return (w, h);
    }
    let (l, r, t, b) = padding_insets(node, w, h, inner);
    let (pad_x, pad_y) = (l + r, t + b);
    // What this node can offer its own children: its width when it has one of
    // its own, else the room it was given — less the padding in between.
    let child_limit = Limits {
        x: if ax {
            Limits::inset(limit.x, pad_x)
        } else {
            Limits::room(w - pad_x)
        },
        y: if ay {
            Limits::inset(limit.y, pad_y)
        } else {
            Limits::room(h - pad_y)
        },
    };
    // Measured at `inner`, so the content already carries this node's own scale:
    // a doubled card hugging a 60px child measures 120, and multiplying by `own`
    // again would make it 240.
    let (content_w, content_h) = measure_content(
        node,
        (w - pad_x).max(0.0),
        (h - pad_y).max(0.0),
        child_limit,
        inner,
    );
    let measured_w = content_w + pad_x;
    let measured_h = content_h + pad_y;

    // `Size` stays the floor even when it is itself past the ceiling — Roblox
    // never shrinks an object below it — so only the *grown* part is capped.
    let new_w = if ax {
        w.max(Limits::cap(limit.x, measured_w))
    } else {
        w
    };
    let new_h = if ay {
        h.max(Limits::cap(limit.y, measured_h))
    } else {
        h
    };
    (new_w, new_h)
}

/// The bounding content size of `node`'s children, given a content box of
/// `(content_w, content_h)`. Used by AutomaticSize.
fn measure_content(
    node: &SceneNode,
    content_w: f64,
    content_h: f64,
    limit: Limits,
    inner: f64,
) -> (f64, f64) {
    let content = Rect {
        x: 0.0,
        y: 0.0,
        width: content_w,
        height: content_h,
    };
    let children = layout_children(node);

    let (mut w, mut h) = if let Some(list) = find_modifier(node, "UIListLayout") {
        let m = list_metrics(content, list, &children, automatic_axes(node), limit, inner);
        if m.vertical {
            (m.cross_max, m.total_main)
        } else {
            (m.total_main, m.cross_max)
        }
    } else if let Some(grid) = find_modifier(node, "UIGridLayout") {
        let g = grid_metrics(content, grid, children.len(), inner);
        (g.block_w, g.block_h)
    } else if let Some(table) = find_modifier(node, "UITableLayout") {
        // The table's natural extent — `FillEmptySpace*` fills a container that
        // has a size, and this is the pass that decides what that size is.
        let lines = table_lines(table, &children);
        table_metrics(content, table, &lines, limit, inner).block()
    } else if let Some(page) = find_modifier(node, "UIPageLayout") {
        // Pages are stacked one container apart, so the strip's extent is not a
        // content size anybody could hug: an auto-sized pager takes the current
        // page, which is the only one the container is meant to show.
        let order = flow_order(&children, page);
        match order.get(page_index(page, order.len())) {
            Some(&(_, current)) => resolve_size(current, content, limit, inner),
            None => (0.0, 0.0),
        }
    } else {
        // Free children: bounding box via the SAME placement math as child_rect (so
        // AnchorPoint is honored and the measured extent matches where children land).
        // NOTE: scale Position on the auto axis resolves against a ~0 content size and
        // is dropped (consistent with the deferred scale-on-auto-axis limitation).
        let mut max_w: f64 = 0.0;
        let mut max_h: f64 = 0.0;
        for &(_, child) in &children {
            let r = child_rect(child, content, limit, inner);
            max_w = max_w.max(r.x + r.width);
            max_h = max_h.max(r.y + r.height);
        }
        (max_w, max_h)
    };

    // A text class contributes its measured `TextBounds` (a Vector2 injected by the
    // adapter, since font metrics live browser-side). Auto-size hugs the larger of
    // the children bounding box and the text.
    //
    // The adapter measures at the node's own `TextSize`, knowing nothing about any
    // `UIScale` above it, so the bounds arrive unscaled and are converted here.
    // A `UIScale` enlarges the text it covers along with everything else — that is
    // how a whole screen scales to the viewport — so a doubled label hugs twice
    // the text it would have hugged on its own.
    if let Some(tb) = vec2_prop(node, "TextBounds") {
        w = w.max(tb.x * inner);
        h = h.max(tb.y * inner);
    }
    (w, h)
}

// --- content box (padding + scrolling canvas) --------------------------------

/// The box children lay out within: a `ScrollingFrame`'s `CanvasSize` (so content
/// can exceed the window), then inset by `UIPadding`.
fn content_box(node: &SceneNode, rect: Rect, inner: f64) -> Rect {
    let mut content = rect;
    if node.class_name == "ScrollingFrame" {
        if let Some(cs) = node
            .properties
            .get("CanvasSize")
            .and_then(PropertyValue::as_udim2)
        {
            let cw = resolve_axis(cs.x, rect.width, inner);
            let ch = resolve_axis(cs.y, rect.height, inner);
            content.width = if cw > 0.0 { cw } else { rect.width };
            content.height = if ch > 0.0 { ch } else { rect.height };
        }
    }
    let (l, r, t, b) = padding_insets(node, content.width, content.height, inner);
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
///
/// `SortOrder` defaults to `Name`, which is the engine's own default on every
/// `UIGridStyleLayout` (verified in Studio: a fresh `UIListLayout`, `UIGridLayout`,
/// `UIPageLayout` and `UITableLayout` all read `Enum.SortOrder.Name`). Children
/// with equal names then keep source order, since the sort is stable — which is
/// what the engine does too, and why a tree that never sets `Name` (every node
/// named after its class) flows in source order either way.
fn flow_order<'a>(
    children: &[(usize, &'a SceneNode)],
    modifier: &SceneNode,
) -> Vec<(usize, &'a SceneNode)> {
    let mut order = children.to_vec();
    if enum_name(modifier, "SortOrder").unwrap_or("Name") == "Name" {
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

/// One run of children along the main axis. Without `Wraps` there is exactly
/// one, holding every child — which is why the placement math below is written
/// per line and needs no separate non-wrapping path.
struct ListLine {
    /// Half-open range into the flow order.
    start: usize,
    end: usize,
    /// Sum of the visible items' main sizes, plus the gaps between them.
    main_total: f64,
    /// The tallest (or widest) visible item, i.e. the line's cross extent.
    cross_max: f64,
    visible_count: usize,
}

struct ListMetrics {
    vertical: bool,
    /// Main extent of the longest line — the whole list's when it doesn't wrap.
    total_main: f64,
    /// Cross extent of every line stacked, gaps included.
    cross_max: f64,
    gap: f64,
    wraps: bool,
    lines: Vec<ListLine>,
}

fn list_metrics(
    content: Rect,
    list: &SceneNode,
    children: &[(usize, &SceneNode)],
    auto_axes: (bool, bool),
    limit: Limits,
    inner: f64,
) -> ListMetrics {
    let vertical = enum_name(list, "FillDirection") != Some("Horizontal");
    let (main_content, _cross_content) = if vertical {
        (content.height, content.width)
    } else {
        (content.width, content.height)
    };
    let gap = udim_prop(list, "Padding").map_or(0.0, |u| resolve_axis(u, main_content, inner));
    // `Wraps` breaks the flow onto a new line once an item no longer fits along
    // the fill direction — CSS `flex-wrap: wrap`, and Roblox's own flex model.
    //
    // The room it wraps against is the content box when the fill direction has a
    // width of its own. When that axis is being measured (`AutomaticSize` on it)
    // the box is 0 — or an explicit `Size` that is only a minimum — so wrapping
    // against it would put every item on its own line: an auto-sized row of
    // buttons measured a line per button while the paint, which runs against the
    // real width, still laid them side by side. The ceiling the parent leaves
    // (see `Limits`) is the room in that case, and only when there is no ceiling
    // either do the items measure as one run — CSS `max-content`, and the same
    // "unconstrained fill axis" rule `grid_metrics` applies.
    //
    // Measuring and painting have to agree here: sizing a footer for one row and
    // then painting two puts the second row outside the box that was grown for it.
    let auto_main = if vertical { auto_axes.1 } else { auto_axes.0 };
    let main_limit = if vertical { limit.y } else { limit.x };
    // A fill axis with no room on it is unconstrained, not a zero-wide box to
    // break every item against — the same reading `grid_metrics` gives a
    // `line_len <= 0` fill axis, and `Limits` gives a parent with no width.
    // Wrapping against zero put every item on a line of its own: a select's
    // caret dropped below its own label, inside a box that had not been sized
    // yet.
    let wrap_room = if auto_main {
        main_limit
    } else {
        Limits::room(main_content)
    };
    let wraps = wrap_room.is_some()
        && list
            .properties
            .get("Wraps")
            .and_then(PropertyValue::as_bool)
            .unwrap_or(false);
    let wrap_room = wrap_room.unwrap_or(main_content);

    let mut lines: Vec<ListLine> = Vec::new();
    let mut line = ListLine {
        start: 0,
        end: 0,
        main_total: 0.0,
        cross_max: 0.0,
        visible_count: 0,
    };
    for (i, &(_, child)) in children.iter().enumerate() {
        // Roblox UIListLayout ignores `Visible = false` siblings: they take
        // neither a slot nor a gap, so the visible items pack together (and
        // AutomaticSize hugs only them). They still belong to whichever line is
        // open, because they are still placed at its cursor.
        if !child.visible() {
            line.end = i + 1;
            continue;
        }
        let (w, h) = resolve_size(child, content, limit, inner);
        let (main, cross) = if vertical { (h, w) } else { (w, h) };
        let advance = if line.visible_count == 0 {
            main
        } else {
            gap + main
        };
        // An item wider than the whole line still gets a line of its own rather
        // than an empty one before it — hence the `visible_count > 0` guard.
        if wraps && line.visible_count > 0 && line.main_total + advance > wrap_room + EPS {
            line.end = i;
            lines.push(std::mem::replace(
                &mut line,
                ListLine {
                    start: i,
                    end: i,
                    main_total: 0.0,
                    cross_max: 0.0,
                    visible_count: 0,
                },
            ));
            line.main_total = main;
        } else {
            line.main_total += advance;
        }
        line.cross_max = line.cross_max.max(cross);
        line.visible_count += 1;
        line.end = i + 1;
    }
    line.end = children.len();
    lines.push(line);

    let total_main = lines.iter().fold(0.0_f64, |acc, l| acc.max(l.main_total));
    let cross_max = lines.iter().map(|l| l.cross_max).sum::<f64>()
        + gap * (lines.len().saturating_sub(1) as f64);
    ListMetrics {
        vertical,
        total_main,
        cross_max,
        gap,
        wraps,
        lines,
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
    limit: Limits,
    parent_path: &str,
    out: &mut BTreeMap<String, LayoutNode>,
    inner: f64,
) -> Result<(), LayoutError> {
    let order = flow_order(children, list);
    let m = list_metrics(content, list, &order, (false, false), limit, inner);
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
    // The gap `list_metrics` already broke the lines with — recomputing it here
    // would be a second source of truth for where the wraps landed.
    let gap = m.gap;

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

    // Where the stack of lines starts on the cross axis. One line keeps the
    // whole content box and sits at 0, so a non-wrapping list aligns its items
    // against the container exactly as before; several lines align as a block
    // (CSS `align-content`) and each item then aligns inside its own line.
    let block_cross = if m.wraps { m.cross_max } else { cross_content };
    let mut line_cursor = if m.lines.len() > 1 {
        align_offset(cross_content, block_cross, cross_align)
    } else {
        0.0
    };

    for line in &m.lines {
        let line_cross = if m.lines.len() > 1 {
            line.cross_max
        } else {
            cross_content
        };
        let free = (main_content - line.main_total).max(0.0);

        // `Fill` on the main axis grows every item, which is the same
        // distribution a per-child `UIFlexItem` asks for — so an explicit
        // `UIFlexItem` anywhere in the row wins, and `Fill` is the fallback that
        // gives each item weight 1. Wrapping makes this per line, like flexbox:
        // each line spreads only its own leftover space.
        let explicit_weight: f64 = order[line.start..line.end]
            .iter()
            .filter(|(_, c)| c.visible())
            .map(|&(_, c)| flex_grow_weight(c))
            .sum();
        let fill_all = explicit_weight <= 0.0 && main_flex == "Fill";
        let weight_sum = if fill_all {
            line.visible_count as f64
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
            flex_spacing(main_flex, free, line.visible_count)
        };

        let mut cursor = match &spacing {
            Some(s) => s.start,
            None => align_offset(main_content, line.main_total, main_align),
        };
        let between = spacing.as_ref().map_or(0.0, |s| s.between);

        for &(idx, child) in &order[line.start..line.end] {
            let (w, h) = resolve_size(child, content, limit, inner);
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
                cross_size = line_cross;
            }
            let cross_off = line_cursor + align_offset(line_cross, cross_size, cross_align);
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
            place_node(child, rect, format!("{parent_path}/{idx}"), out, inner)?;
            // `Visible = false` children still get a rect (the renderer hides
            // them via CSS), but they must not consume flow space — mirror
            // Roblox by advancing the cursor only for visible items so the rest
            // pack up against them.
            if child.visible() {
                cursor += main_size + gap + between;
            }
        }
        line_cursor += line.cross_max + gap;
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

fn grid_metrics(content: Rect, grid: &SceneNode, count: usize, inner: f64) -> GridMetrics {
    let cell = grid
        .properties
        .get("CellSize")
        .and_then(PropertyValue::as_udim2)
        .map(|u| {
            (
                resolve_axis(u.x, content.width, inner),
                resolve_axis(u.y, content.height, inner),
            )
        })
        // Roblox default CellSize {0,100},{0,100} — offsets like any other, so a
        // scaled grid gets scaled default cells.
        .unwrap_or((100.0 * inner, 100.0 * inner));
    let cellpad = grid
        .properties
        .get("CellPadding")
        .and_then(PropertyValue::as_udim2)
        .map(|u| {
            (
                resolve_axis(u.x, content.width, inner),
                resolve_axis(u.y, content.height, inner),
            )
        })
        .unwrap_or((5.0 * inner, 5.0 * inner)); // Roblox default CellPadding {0,5},{0,5}
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
    inner: f64,
) -> Result<(), LayoutError> {
    let order = flow_order(children, grid);
    let g = grid_metrics(content, grid, order.len(), inner);
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
        place_node(child, rect, format!("{parent_path}/{idx}"), out, inner)?;
    }
    Ok(())
}

// --- UIPageLayout ------------------------------------------------------------

/// The page a `UIPageLayout` shows, as an index into its flow order.
///
/// The engine's own `CurrentPage` is a **GuiObject reference**, and a Scene IR
/// property is a datatype — never a node — so it cannot cross the boundary. loom
/// reads `CurrentPageIndex` instead: a plain 0-based int the frontend writes.
/// `@loom-dev/runtime`'s `UIPageLayout` sets it from `JumpToIndex`/`JumpTo`/
/// `Next`/`Previous` and keeps `CurrentPage` pointing at the instance, so app
/// code that reads the Roblox property still gets the Roblox answer.
///
/// Out of range clamps rather than wraps, matching `JumpToIndex`.
fn page_index(page: &SceneNode, count: usize) -> usize {
    if count == 0 {
        return 0;
    }
    let raw = page
        .properties
        .get("CurrentPageIndex")
        .and_then(PropertyValue::as_int)
        .unwrap_or(0);
    raw.clamp(0, count as i64 - 1) as usize
}

/// `UIPageLayout` places each child at its own size, aligned inside the
/// container, then displaces it along the fill direction by whole pages — one
/// page being the container extent plus `Padding`. The current page lands in the
/// container and its neighbours sit one page out either side, so a parent with
/// `ClipsDescendants` shows exactly one, which is the point of the class.
///
/// Verified against the engine (Studio, Edit datamodel): pages keep their own
/// `Size` rather than being stretched to the container, the stride is
/// `container + Padding`, `FillDirection` defaults to `Horizontal` (unlike
/// `UIListLayout`), and both alignment properties apply — a centered page is
/// centered on the main axis too, not just the cross one.
///
/// `Animated`/`TweenTime`/`EasingStyle`/`EasingDirection` are animation rather
/// than geometry, so this is always the settled state. `Circular` only decides
/// which page `Next`/`Previous` reach (see `@loom-dev/runtime`): the engine's own
/// circular placement leaves the strip translated by a whole lap mid-wrap, which
/// is a scrolling artifact, not a layout loom should reproduce.
fn place_with_page(
    content: Rect,
    page: &SceneNode,
    children: &[(usize, &SceneNode)],
    limit: Limits,
    parent_path: &str,
    out: &mut BTreeMap<String, LayoutNode>,
    inner: f64,
) -> Result<(), LayoutError> {
    let order = flow_order(children, page);
    let vertical = enum_name(page, "FillDirection") == Some("Vertical");
    let main_content = if vertical {
        content.height
    } else {
        content.width
    };
    let stride = main_content
        + udim_prop(page, "Padding").map_or(0.0, |u| resolve_axis(u, main_content, inner));
    let current = page_index(page, order.len());
    let h_align = enum_name(page, "HorizontalAlignment").unwrap_or("Left");
    let v_align = enum_name(page, "VerticalAlignment").unwrap_or("Top");

    for (i, &(idx, child)) in order.iter().enumerate() {
        let (w, h) = resolve_size(child, content, limit, inner);
        let offset = (i as f64 - current as f64) * stride;
        let x = content.x
            + align_offset(content.width, w, h_align)
            + if vertical { 0.0 } else { offset };
        let y = content.y
            + align_offset(content.height, h, v_align)
            + if vertical { offset } else { 0.0 };
        place_node(
            child,
            Rect {
                x,
                y,
                width: w,
                height: h,
            },
            format!("{parent_path}/{idx}"),
            out,
            inner,
        )?;
    }
    Ok(())
}

// --- UITableLayout -----------------------------------------------------------

/// A `UITableLayout`'s tracks. Its direct children are *lines* — rows under
/// `MajorAxis = RowMajor` (the default), columns under `ColumnMajor` — and their
/// own children are the cells.
struct TableMetrics {
    column_major: bool,
    /// Width of each column, in column order.
    columns: Vec<f64>,
    /// Height of each row, in row order.
    rows: Vec<f64>,
    pad_x: f64,
    pad_y: f64,
}

impl TableMetrics {
    /// Extent of the whole table: every track plus the gaps between them.
    fn block(&self) -> (f64, f64) {
        (
            span(&self.columns, self.pad_x),
            span(&self.rows, self.pad_y),
        )
    }

    /// `(row, col)` of the cell at position `cell` in line `line`.
    fn track_of(&self, line: usize, cell: usize) -> (usize, usize) {
        if self.column_major {
            (cell, line)
        } else {
            (line, cell)
        }
    }

    /// Grow (or shrink) the tracks so the table spans the container, as
    /// `FillEmptySpaceColumns`/`FillEmptySpaceRows` ask.
    ///
    /// The engine scales tracks **proportionally** to their natural size, and it
    /// does so in both directions — a table whose natural width overruns the
    /// container is squeezed down by the same rule (verified in Studio: two
    /// 120px cells in a 100px box with 10px padding came out 45px each). Tracks
    /// that are all zero stay zero: there is no proportion to distribute by, and
    /// inventing an equal split would size cells the engine leaves empty.
    fn fill(&mut self, content: Rect, table: &SceneNode) {
        let fill_columns = bool_prop(table, "FillEmptySpaceColumns");
        let fill_rows = bool_prop(table, "FillEmptySpaceRows");
        if fill_columns {
            scale_tracks(&mut self.columns, content.width, self.pad_x);
        }
        if fill_rows {
            scale_tracks(&mut self.rows, content.height, self.pad_y);
        }
    }
}

/// Total extent of `tracks` laid end to end with `gap` between them.
fn span(tracks: &[f64], gap: f64) -> f64 {
    tracks.iter().sum::<f64>() + gap * (tracks.len().saturating_sub(1) as f64)
}

/// Start offset of every track, in order (the running sum plus gaps).
fn track_offsets(tracks: &[f64], gap: f64) -> Vec<f64> {
    let mut offsets = Vec::with_capacity(tracks.len());
    let mut cursor = 0.0;
    for size in tracks {
        offsets.push(cursor);
        cursor += size + gap;
    }
    offsets
}

fn scale_tracks(tracks: &mut [f64], available: f64, gap: f64) {
    let natural: f64 = tracks.iter().sum();
    let room = available - gap * (tracks.len().saturating_sub(1) as f64);
    if natural <= 0.0 || room <= 0.0 {
        return;
    }
    let scale = room / natural;
    for size in tracks.iter_mut() {
        *size *= scale;
    }
}

fn bool_prop(node: &SceneNode, key: &str) -> bool {
    node.properties
        .get(key)
        .and_then(PropertyValue::as_bool)
        .unwrap_or(false)
}

/// One line of a table (a row, or a column under `ColumnMajor`) with the cells
/// that flow inside it. Both carry the positional index their id is built from.
struct TableLine<'a> {
    index: usize,
    node: &'a SceneNode,
    cells: Vec<(usize, &'a SceneNode)>,
}

/// The table's flow: its visible lines, each with its own visible cells, both in
/// `SortOrder`. Invisible nodes are left out — the engine gives them neither a
/// track nor a gap (verified: an invisible middle cell collapsed both its column
/// and one padding gap) — and are placed from their own `Position` instead.
fn table_lines<'a>(table: &SceneNode, children: &[(usize, &'a SceneNode)]) -> Vec<TableLine<'a>> {
    flow_order(children, table)
        .into_iter()
        .filter(|(_, line)| line.visible())
        .map(|(index, node)| TableLine {
            index,
            node,
            cells: flow_order(&layout_children(node), table)
                .into_iter()
                .filter(|(_, cell)| cell.visible())
                .collect(),
        })
        .collect()
}

/// Column widths and row heights: a column is as wide as its widest cell, a row
/// as tall as its tallest — the cells' own `Size`, resolved against the *table's*
/// content box (verified: a `0.25` scale cell measured a quarter of the table,
/// not of its row).
fn table_metrics(
    content: Rect,
    table: &SceneNode,
    lines: &[TableLine<'_>],
    limit: Limits,
    inner: f64,
) -> TableMetrics {
    let column_major = enum_name(table, "MajorAxis") == Some("ColumnMajor");
    let padding = table
        .properties
        .get("Padding")
        .and_then(PropertyValue::as_udim2);
    let pad_x = padding.map_or(0.0, |p| resolve_axis(p.x, content.width, inner));
    let pad_y = padding.map_or(0.0, |p| resolve_axis(p.y, content.height, inner));

    let across = lines.iter().map(|l| l.cells.len()).max().unwrap_or(0);
    let (n_rows, n_cols) = if column_major {
        (across, lines.len())
    } else {
        (lines.len(), across)
    };
    let mut m = TableMetrics {
        column_major,
        columns: vec![0.0; n_cols],
        rows: vec![0.0; n_rows],
        pad_x,
        pad_y,
    };
    for (line, entry) in lines.iter().enumerate() {
        for (cell, &(_, node)) in entry.cells.iter().enumerate() {
            let (w, h) = resolve_size(node, content, limit, inner);
            let (row, col) = m.track_of(line, cell);
            m.columns[col] = m.columns[col].max(w);
            m.rows[row] = m.rows[row].max(h);
        }
    }
    m
}

/// Place a `UITableLayout`'s lines and cells.
///
/// A line spans the whole table on its minor axis and its own track on the major
/// one — a row is table-wide and row-tall — which is what the engine reports for
/// the line frames themselves. Cells then land on the track intersections. The
/// line's own `Size` is ignored (the table sizes it), and so is any `UIPadding`
/// on it: the tracks are measured against the table's content box, so insetting
/// each line separately would slide its cells off the columns they define. A
/// `UIScale` on a line falls out the same way — the cells are the table's to
/// place, so they are laid out at the table's own scale.
fn place_with_table(
    content: Rect,
    table: &SceneNode,
    children: &[(usize, &SceneNode)],
    limit: Limits,
    parent_path: &str,
    out: &mut BTreeMap<String, LayoutNode>,
    inner: f64,
) -> Result<(), LayoutError> {
    let lines = table_lines(table, children);
    let mut m = table_metrics(content, table, &lines, limit, inner);
    m.fill(content, table);
    let (block_w, block_h) = m.block();
    let start_x = content.x
        + align_offset(
            content.width,
            block_w,
            enum_name(table, "HorizontalAlignment").unwrap_or("Left"),
        );
    let start_y = content.y
        + align_offset(
            content.height,
            block_h,
            enum_name(table, "VerticalAlignment").unwrap_or("Top"),
        );
    let col_x = track_offsets(&m.columns, m.pad_x);
    let row_y = track_offsets(&m.rows, m.pad_y);

    for (index, line) in lines.iter().enumerate() {
        let line_rect = if m.column_major {
            Rect {
                x: start_x + col_x[index],
                y: start_y,
                width: m.columns[index],
                height: block_h,
            }
        } else {
            Rect {
                x: start_x,
                y: start_y + row_y[index],
                width: block_w,
                height: m.rows[index],
            }
        };
        let line_path = format!("{parent_path}/{}", line.index);
        record(line.node, line_rect, &line_path, out)?;
        for (cell, &(cell_idx, node)) in line.cells.iter().enumerate() {
            let (row, col) = m.track_of(index, cell);
            place_node(
                node,
                Rect {
                    x: start_x + col_x[col],
                    y: start_y + row_y[row],
                    width: m.columns[col],
                    height: m.rows[row],
                },
                format!("{line_path}/{cell_idx}"),
                out,
                inner,
            )?;
        }
        // Hidden cells take no track, so they keep their own Position inside the
        // line — the same rect the engine leaves them at.
        let line_limit = Limits::definite(line_rect.width, line_rect.height);
        for &(cell_idx, node) in layout_children(line.node)
            .iter()
            .filter(|(_, c)| !c.visible())
        {
            let rect = child_rect(node, line_rect, line_limit, inner);
            place_node(node, rect, format!("{line_path}/{cell_idx}"), out, inner)?;
        }
    }
    // Same for a hidden line: out of the flow, placed from its own Position.
    for &(idx, line) in children.iter().filter(|(_, c)| !c.visible()) {
        let rect = child_rect(line, content, limit, inner);
        place_node(line, rect, format!("{parent_path}/{idx}"), out, inner)?;
    }
    Ok(())
}

// --- placement ---------------------------------------------------------------

/// Resolve a free-positioned child's rect (size + anchor/position).
///
/// `unit` is the scale of the parent's content box, so it converts the child's
/// `Position` offsets — but never the child's *own* `UIScale`, which belongs to
/// its size. A `Scale` tween on a button therefore grows it about its anchor
/// point and leaves the point itself where its parent put it, which is what the
/// engine does and why an anchored-centre button pops symmetrically.
fn child_rect(node: &SceneNode, parent_content: Rect, limit: Limits, unit: f64) -> Rect {
    let (w, h) = resolve_size(node, parent_content, limit, unit);
    let pos = node.position();
    let anchor = node.anchor_point();
    Rect {
        x: parent_content.x + resolve_axis(pos.x, parent_content.width, unit) - anchor.x * w,
        y: parent_content.y + resolve_axis(pos.y, parent_content.height, unit) - anchor.y * h,
        width: w,
        height: h,
    }
}

/// Record `node`'s rect under its id (its own, or the positional path).
///
/// Split out of [`place_node`] because `UITableLayout` places its lines itself:
/// a line's rect comes from the table's tracks, and its children are the table's
/// cells rather than its own free-positioned content.
fn record(
    node: &SceneNode,
    rect: Rect,
    path: &str,
    out: &mut BTreeMap<String, LayoutNode>,
) -> Result<(), LayoutError> {
    let id = node.id.clone().unwrap_or_else(|| path.to_string());
    if out.contains_key(&id) {
        return Err(LayoutError::DuplicateId(id));
    }
    out.insert(id, LayoutNode { rect });
    Ok(())
}

/// Place `node` at the already-resolved `rect`, store it, then lay out children.
///
/// `unit` is the scale the caller placed this node at; `rect` already carries the
/// node's own `UIScale` (whoever resolved the size applied it), so all that is
/// left here is to hand the product down — everything the node holds, from its
/// padding to its grandchildren's offsets, renders through it.
fn place_node(
    node: &SceneNode,
    rect: Rect,
    path: String,
    out: &mut BTreeMap<String, LayoutNode>,
    unit: f64,
) -> Result<(), LayoutError> {
    record(node, rect, &path, out)?;

    let inner = unit * own_scale(node);
    let content = content_box(node, rect, inner);
    let children = layout_children(node);
    // Placement runs against the node's final rect, so its content box is a real
    // ceiling for the children — whatever `AutomaticSize` asked for has already
    // been resolved into it. The one container that is not its children's
    // ceiling is a scrolling canvas (see [`content_limits`]).
    let limit = content_limits(node, rect, content, inner);

    if let Some(list) = find_modifier(node, "UIListLayout") {
        place_with_list(content, list, &children, limit, &path, out, inner)?;
    } else if let Some(grid) = find_modifier(node, "UIGridLayout") {
        place_with_grid(content, grid, &children, &path, out, inner)?;
    } else if let Some(table) = find_modifier(node, "UITableLayout") {
        place_with_table(content, table, &children, limit, &path, out, inner)?;
    } else if let Some(page) = find_modifier(node, "UIPageLayout") {
        place_with_page(content, page, &children, limit, &path, out, inner)?;
    } else {
        for &(idx, child) in &children {
            let r = child_rect(child, content, limit, inner);
            place_node(child, r, format!("{path}/{idx}"), out, inner)?;
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
    // Nothing sits above the root, so one scene offset is one real pixel here. A
    // `UIScale` on the root still scales everything inside it; the root's own rect
    // is the viewport by fiat, so there is no size of its own left to multiply.
    place_node(root, vp_rect, "0".to_string(), &mut rects, 1.0)?;
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

    /// A horizontal `Wraps` list of `count` items, each `item_w` wide and 40
    /// tall, inside an 800-wide container. `Padding` is the gap in both axes.
    fn wrapping_row(count: usize, item_w: f64, padding: f64) -> SceneNode {
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Horizontal")),
                ("Padding", udim(0.0, padding)),
                ("Wraps", PropertyValue::Known(KnownProperty::Bool(true))),
            ],
        );
        let mut container = with("Frame", "Container", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]);
        container.children.push(list);
        for i in 0..count {
            container.children.push(with(
                "Frame",
                &format!("Item{i}"),
                &[("Size", udim2(0.0, item_w, 0.0, 40.0))],
            ));
        }
        container
    }

    #[test]
    fn ui_list_wraps_onto_new_lines() {
        // 300 + 10 + 300 = 610 fits in 800; a third would need 920. Lines stack
        // on the cross axis, separated by the same `Padding`.
        let r = compute_layout(&screen(vec![wrapping_row(3, 300.0, 10.0)]), VP).unwrap();
        assert_eq!(r.rects["0/0/0"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/0"].rect.y, 0.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 310.0);
        assert_eq!(r.rects["0/0/1"].rect.y, 0.0);
        assert_eq!(r.rects["0/0/2"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/2"].rect.y, 50.0);
    }

    #[test]
    fn ui_list_without_wraps_overflows_in_one_line() {
        // The default, unchanged: items keep running past the container edge.
        let mut container = wrapping_row(3, 300.0, 10.0);
        container.children[0].properties.insert(
            "Wraps".into(),
            PropertyValue::Known(KnownProperty::Bool(false)),
        );
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0/2"].rect.x, 620.0);
        assert_eq!(r.rects["0/0/2"].rect.y, 0.0);
    }

    #[test]
    fn ui_list_wrap_gives_an_oversized_item_its_own_line() {
        // Wider than the container: it must not push an empty line ahead of
        // itself, and the next item starts a fresh one.
        let mut container = wrapping_row(2, 100.0, 0.0);
        container.children[1]
            .properties
            .insert("Size".into(), udim2(0.0, 900.0, 0.0, 40.0));
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 900.0,
                height: 40.0
            }
        );
        assert_eq!(
            r.rects["0/0/1"].rect,
            Rect {
                x: 0.0,
                y: 40.0,
                width: 100.0,
                height: 40.0
            }
        );
    }

    #[test]
    fn ui_list_wrap_aligns_each_line_and_the_block() {
        // Center on both axes: every line centers its own items along the main
        // axis, and the stack of lines centers as a block on the cross axis.
        let mut container = wrapping_row(3, 300.0, 10.0);
        container.children[0].properties.insert(
            "HorizontalAlignment".into(),
            enum_item("HorizontalAlignment", "Center"),
        );
        container.children[0].properties.insert(
            "VerticalAlignment".into(),
            enum_item("VerticalAlignment", "Center"),
        );
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // Line 1 is 610 wide in 800 -> starts at 95; line 2 is 300 -> at 250.
        assert_eq!(r.rects["0/0/0"].rect.x, 95.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 405.0);
        assert_eq!(r.rects["0/0/2"].rect.x, 250.0);
        // The block is 40 + 10 + 40 = 90 tall in 600 -> starts at 255.
        assert_eq!(r.rects["0/0/0"].rect.y, 255.0);
        assert_eq!(r.rects["0/0/2"].rect.y, 305.0);
    }

    #[test]
    fn automatic_size_measures_the_wrapped_block() {
        // AutomaticSize has to hug the wrapped shape — every line tall, not the
        // single 40px run the three items would form without wrapping. The main
        // axis stays fixed at 800: that is what the lines wrap against.
        let mut container = wrapping_row(3, 300.0, 10.0);
        container
            .properties
            .insert("AutomaticSize".into(), enum_item("AutomaticSize", "Y"));
        container
            .properties
            .insert("Size".into(), udim2(1.0, 0.0, 0.0, 0.0));
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 800.0);
        assert_eq!(r.rects["0/0"].rect.height, 90.0);
    }

    #[test]
    fn automatic_main_axis_measures_one_line() {
        // The fill axis is itself automatic, so there is nothing to wrap against:
        // the items measure as one run and the container hugs it. Wrapping every
        // item onto its own line (against a 0-wide box) made a row of buttons
        // measure one line per button, so an auto-sized footer came out a whole
        // row too tall while the paint still put them side by side.
        let mut container = wrapping_row(2, 100.0, 10.0);
        container
            .properties
            .insert("AutomaticSize".into(), enum_item("AutomaticSize", "XY"));
        container
            .properties
            .insert("Size".into(), udim2(0.0, 0.0, 0.0, 0.0));
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 210.0);
        assert_eq!(r.rects["0/0"].rect.height, 40.0);
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
                    (
                        "Visible",
                        PropertyValue::Known(KnownProperty::Bool(visible)),
                    ),
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
                // The engine's default is `Name`; this test is about the other one.
                ("SortOrder", enum_item("SortOrder", "LayoutOrder")),
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

    /// The clean-ui `Scroller` shape from issue #12: a `fromScale(1, 0)` column
    /// with `AutomaticSize = Y` inside an `AutomaticCanvasSize = Y` frame, the
    /// idiom every scrolling list in Roblox is built from. Capping the column at
    /// the window made the canvas exactly the window — nothing overflowed,
    /// nothing scrolled, and no scroll bar was ever drawn.
    #[test]
    fn automatic_canvas_size_leaves_children_no_ceiling() {
        let mut column = with(
            "Frame",
            "Column",
            &[
                ("Size", udim2(1.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        column.children.push(with(
            "Frame",
            "Tall",
            &[("Size", udim2(1.0, 0.0, 0.0, 500.0))],
        ));
        let mut scroll = with(
            "ScrollingFrame",
            "Scroll",
            &[
                ("Size", udim2(1.0, 0.0, 0.0, 200.0)),
                ("CanvasSize", udim2(1.0, 0.0, 0.0, 0.0)),
                ("AutomaticCanvasSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        // The horizontal `UIListLayout` the component uses — placement through a
        // list has to honor the same ceiling the free path does.
        scroll.children.push(with(
            "UIListLayout",
            "List",
            &[("FillDirection", enum_item("FillDirection", "Horizontal"))],
        ));
        scroll.children.push(column);
        let r = compute_layout(&screen(vec![scroll]), VP).unwrap();
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 800.0,
                height: 500.0
            }
        );
    }

    /// A `CanvasSize` that gives an axis a real extent is still the ceiling: the
    /// exception is "the canvas grows to the content", not "no ceiling inside a
    /// ScrollingFrame".
    #[test]
    fn a_fixed_canvas_still_caps_automatic_size_children() {
        let mut column = with(
            "Frame",
            "Column",
            &[
                ("Size", udim2(1.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        column.children.push(with(
            "Frame",
            "Tall",
            &[("Size", udim2(1.0, 0.0, 0.0, 500.0))],
        ));
        let mut scroll = with(
            "ScrollingFrame",
            "Scroll",
            &[
                ("Size", udim2(1.0, 0.0, 0.0, 200.0)),
                ("CanvasSize", udim2(0.0, 800.0, 0.0, 300.0)),
            ],
        );
        scroll.children.push(column);
        let r = compute_layout(&screen(vec![scroll]), VP).unwrap();
        assert_eq!(r.rects["0/0/0"].rect.height, 300.0);
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

    /// The library card: `Size = fromScale(1, 1)` + `AutomaticSize.XY` inside a
    /// column that gives it a share of the row, with content `content_w` wide
    /// that cannot get any narrower (a row of buttons, a long word).
    fn card_in_column(share: f64, content_w: f64) -> SceneNode {
        let mut card = with(
            "Frame",
            "Card",
            &[
                ("Size", udim2(1.0, 0.0, 1.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        card.children.push(with(
            "Frame",
            "Footer",
            &[("Size", udim2(0.0, content_w, 0.0, 40.0))],
        ));
        let mut column = with(
            "Frame",
            "Column",
            &[("Size", udim2(share, 0.0, 0.0, 100.0))],
        );
        column.children.push(card);
        column
    }

    #[test]
    fn automatic_size_stops_at_the_room_its_parent_has() {
        // Roblox grows an AutomaticSize object "up to maximum size allowed by
        // the parent". Unbounded, a card whose content has an irreducible
        // minimum runs straight out of the column that positions it.
        let r = compute_layout(&screen(vec![card_in_column(0.45, 500.0)]), VP).unwrap();
        // The column is 45% of 800 = 360, and the card stops there rather than
        // taking the 500 its footer asks for.
        assert_eq!(r.rects["0/0"].rect.width, 360.0);
        assert_eq!(r.rects["0/0/0"].rect.width, 360.0);
        // The content that still does not fit overflows the card, which is what
        // the engine does — it does not widen it.
        assert_eq!(r.rects["0/0/0/0"].rect.width, 500.0);
    }

    #[test]
    fn a_narrow_column_no_longer_overlaps_its_neighbour() {
        // The reported failure, at the width it appears: five 45% columns in a
        // wrapping row, two to a line. Each card grew to its own content and
        // painted over the card beside it.
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Horizontal")),
                ("Wraps", PropertyValue::Known(KnownProperty::Bool(true))),
            ],
        );
        let mut row = with("Frame", "Row", &[("Size", udim2(1.0, 0.0, 0.0, 400.0))]);
        row.children.push(list);
        for _ in 0..5 {
            row.children.push(card_in_column(0.45, 500.0));
        }
        let r = compute_layout(&screen(vec![row]), VP).unwrap();
        // Two columns per line: 0.45 + 0.45 of 800 fits, a third would not.
        let first = r.rects["0/0/0/0"].rect; // card in column 0
        let second = r.rects["0/0/1/0"].rect; // card in column 1
        assert_eq!(first.y, second.y, "expected both on the first line");
        assert!(
            first.x + first.width <= second.x + EPS,
            "card 0 ends at {} but card 1 starts at {}",
            first.x + first.width,
            second.x,
        );
        // And the third wraps to a second line rather than joining them.
        assert!(r.rects["0/0/2/0"].rect.y > first.y);
    }

    #[test]
    fn an_auto_row_measures_the_wrapping_the_paint_will_do() {
        // An auto-sized footer holding a `Wraps` row of buttons, in a column too
        // narrow for them side by side. Measurement used to treat an auto fill
        // axis as unbounded and size the footer for one row; the paint, which
        // runs against the real width, then wrapped onto two and put the second
        // button outside the box that was grown for it. Both passes now wrap
        // against the same room — the ceiling the column leaves.
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Horizontal")),
                ("Wraps", PropertyValue::Known(KnownProperty::Bool(true))),
            ],
        );
        let mut footer = with(
            "Frame",
            "Footer",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        footer.children.push(list);
        for name in ["Cancel", "Save"] {
            footer.children.push(with(
                "Frame",
                name,
                &[("Size", udim2(0.0, 80.0, 0.0, 40.0))],
            ));
        }
        // 0.125 of 800 = 100: room for one 80-wide button per line, not two.
        let mut column = with(
            "Frame",
            "Column",
            &[("Size", udim2(0.125, 0.0, 0.0, 300.0))],
        );
        column.children.push(footer);
        let r = compute_layout(&screen(vec![column]), VP).unwrap();

        let footer_rect = r.rects["0/0/0"].rect;
        let cancel = r.rects["0/0/0/0"].rect;
        let save = r.rects["0/0/0/1"].rect;
        // Two rows, so the footer is grown for two.
        assert_eq!(footer_rect.height, 80.0);
        assert_eq!(save.y, cancel.y + 40.0);
        // …and every button lands inside it.
        assert!(save.y + save.height <= footer_rect.y + footer_rect.height + EPS);
        assert!(save.x + save.width <= footer_rect.x + footer_rect.width + EPS);
    }

    #[test]
    fn a_parent_with_no_width_is_no_ceiling_at_all() {
        // A box with nothing on an axis does not mean everything inside it is
        // zero. `Size={fromScale(1, 0)} AutomaticSize={Y}` is the library idiom
        // for "as wide as my parent, as tall as my content", and a popover
        // positioned from a ref is 0 wide on the render before the ref
        // resolves. Reading either as a ceiling collapsed the whole subtree —
        // a select's label came out 0 wide and the control vanished.
        let mut label = with(
            "TextLabel",
            "Label",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
                ("TextBounds", vector2(62.0, 18.0)),
            ],
        );
        label.properties.insert("Text".into(), num(0.0)); // presence only
        let mut zero_wide = with(
            "Frame",
            "NoWidth",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        zero_wide.children.push(label);
        let r = compute_layout(&screen(vec![zero_wide]), VP).unwrap();
        // The container has no width, as asked; the label keeps its own.
        assert_eq!(r.rects["0/0"].rect.width, 0.0);
        assert_eq!(r.rects["0/0/0"].rect.width, 62.0);
        // …and it still grows in height, which is what it was asked to do.
        assert_eq!(r.rects["0/0"].rect.height, 18.0);
    }

    #[test]
    fn an_enum_property_written_as_a_string_still_counts() {
        // Roblox coerces a bare string on an enum property, and roblox-ts types
        // it that way, so libraries pass `mode="Custom"` / `valign="Center"`
        // straight through. Reading only the EnumItem form made each of those a
        // silent no-op — this row's grower took no share at all, and the
        // control inside it came out zero wide.
        let list = with(
            "UIListLayout",
            "List",
            &[(
                "FillDirection",
                PropertyValue::Known(KnownProperty::Str("Horizontal".into())),
            )],
        );
        let mut grower = with("Frame", "Grow", &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]);
        grower.children.push(with(
            "UIFlexItem",
            "Flex",
            &[
                (
                    "FlexMode",
                    PropertyValue::Known(KnownProperty::Str("Custom".into())),
                ),
                ("GrowRatio", num(1.0)),
            ],
        ));
        let mut row = with("Frame", "Row", &[("Size", udim2(0.0, 600.0, 0.0, 200.0))]);
        row.children = vec![
            list,
            with("Frame", "Fixed", &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]),
            grower,
        ];
        let r = compute_layout(&screen(vec![row]), VP).unwrap();
        // The string `FillDirection` laid the row out horizontally…
        assert_eq!(r.rects["0/0/1"].rect.x, 100.0);
        // …and the string `FlexMode` took all 400 of the leftover space.
        assert_eq!(r.rects["0/0/1"].rect.width, 500.0);
    }

    #[test]
    fn a_wraps_list_with_no_room_stays_one_run() {
        // A fill axis with nothing on it is unconstrained, not a zero-wide box
        // to break every item against — `grid_metrics` has always read a
        // `line_len <= 0` fill axis that way. Wrapping against zero gave every
        // item a line of its own: a select's caret dropped below its own label
        // because the button around them had not been given a width yet.
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Horizontal")),
                ("Wraps", PropertyValue::Known(KnownProperty::Bool(true))),
                // Source order, so the positional ids below are the flow order —
                // under the engine's `Name` default "Caret" would lead "Label".
                ("SortOrder", enum_item("SortOrder", "LayoutOrder")),
            ],
        );
        // Scale width against a parent that has none: 0 wide, height from content.
        let mut row = with(
            "Frame",
            "Row",
            &[
                ("Size", udim2(1.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        row.children.push(list);
        row.children.push(with(
            "Frame",
            "Label",
            &[("Size", udim2(0.0, 62.0, 0.0, 18.0))],
        ));
        row.children.push(with(
            "Frame",
            "Caret",
            &[("Size", udim2(0.0, 20.0, 0.0, 20.0))],
        ));
        let mut no_width = with(
            "Frame",
            "NoWidth",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        no_width.children.push(row);
        let r = compute_layout(&screen(vec![no_width]), VP).unwrap();
        let label = r.rects["0/0/0/0"].rect;
        let caret = r.rects["0/0/0/1"].rect;
        // Side by side on one line, not stacked.
        assert_eq!(caret.y, label.y);
        assert_eq!(caret.x, label.x + label.width);
        // …so the row is one item tall, not two.
        assert_eq!(r.rects["0/0/0"].rect.height, 20.0);
    }

    #[test]
    fn a_scale_size_against_an_unsized_parent_settles_on_its_content() {
        // Measured in Studio, which is where these numbers come from: a padded
        // 300 box holding an auto-sized row, a fixed 150 label that does not
        // grow, and a control that does — whose own child is
        // `Size={fromScale(1, 0)}` and so has no width of its own to offer.
        //
        // Studio: fieldset 240.5, label 150, control 84.5, inner 84.5. The
        // circular pair (parent waiting on content, content waiting on parent)
        // settles on the text, not on nothing — loom collapsed the whole branch
        // to 0 and the control vanished.
        let list = with(
            "UIListLayout",
            "List",
            &[
                ("FillDirection", enum_item("FillDirection", "Horizontal")),
                ("Wraps", PropertyValue::Known(KnownProperty::Bool(true))),
                ("HorizontalFlex", enum_item("UIFlexAlignment", "Fill")),
                ("Padding", udim(0.0, 6.0)),
            ],
        );
        let mut label = with("Frame", "Label", &[("Size", udim2(0.0, 150.0, 0.0, 20.0))]);
        label.children.push(with(
            "UIFlexItem",
            "LabelFlex",
            &[
                ("FlexMode", enum_item("UIFlexMode", "Custom")),
                ("GrowRatio", num(0.0)),
            ],
        ));

        let mut text = with(
            "TextLabel",
            "Text",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
                ("TextBounds", vector2(84.5, 18.0)),
            ],
        );
        text.properties.insert("Text".into(), num(0.0));
        let mut inner = with(
            "Frame",
            "Inner",
            &[
                ("Size", udim2(1.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "Y")),
            ],
        );
        inner.children.push(text);
        let mut control = with(
            "Frame",
            "Control",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        control.children.push(with(
            "UIFlexItem",
            "ControlFlex",
            &[
                ("FlexMode", enum_item("UIFlexMode", "Custom")),
                ("GrowRatio", num(1.0)),
            ],
        ));
        control.children.push(inner);

        let mut fieldset = with(
            "Frame",
            "Fieldset",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        fieldset.children = vec![list, label, control];

        let mut outer = with("Frame", "Outer", &[("Size", udim2(0.0, 300.0, 0.0, 120.0))]);
        outer.children.push(with(
            "UIPadding",
            "Pad",
            &[
                ("PaddingLeft", udim(0.0, 12.0)),
                ("PaddingRight", udim(0.0, 12.0)),
            ],
        ));
        outer.children.push(fieldset);

        let r = compute_layout(&screen(vec![outer]), VP).unwrap();
        assert_eq!(r.rects["0/0/0"].rect.width, 240.5, "fieldset");
        assert_eq!(r.rects["0/0/0/0"].rect.width, 150.0, "label");
        assert_eq!(r.rects["0/0/0/1"].rect.width, 84.5, "control");
        assert_eq!(r.rects["0/0/0/1/0"].rect.width, 84.5, "inner");
    }

    #[test]
    fn size_stays_the_floor_even_past_the_parent() {
        // The ceiling caps what AutomaticSize *grows*; it never shrinks an
        // object below its own `Size`, which Roblox treats as the minimum.
        let mut child = with(
            "Frame",
            "Wide",
            &[
                ("Size", udim2(0.0, 500.0, 0.0, 40.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        child.children.push(with(
            "Frame",
            "Inner",
            &[("Size", udim2(0.0, 10.0, 0.0, 10.0))],
        ));
        let mut narrow = with(
            "Frame",
            "Narrow",
            &[("Size", udim2(0.0, 100.0, 0.0, 100.0))],
        );
        narrow.children.push(child);
        let r = compute_layout(&screen(vec![narrow]), VP).unwrap();
        assert_eq!(r.rects["0/0/0"].rect.width, 500.0);
    }

    #[test]
    fn nested_auto_widths_inherit_the_ceiling_through_padding() {
        // Card (auto, capped by its column) > padded Body (auto, no width of its
        // own): the Body has to inherit the card's ceiling less the padding
        // between them, or the chain is unbounded again one level down.
        let mut body = with(
            "Frame",
            "Body",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        body.children.push(with(
            "UIPadding",
            "Pad",
            &[
                ("PaddingLeft", udim(0.0, 12.0)),
                ("PaddingRight", udim(0.0, 12.0)),
            ],
        ));
        body.children.push(with(
            "TextLabel",
            "Label",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
                ("TextBounds", vector2(900.0, 18.0)),
            ],
        ));
        let mut card = with(
            "Frame",
            "Card",
            &[
                ("Size", udim2(1.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        card.children.push(body);
        let mut column = with("Frame", "Column", &[("Size", udim2(0.45, 0.0, 0.0, 100.0))]);
        column.children.push(card);
        let r = compute_layout(&screen(vec![column]), VP).unwrap();
        // Column 360 -> card 360 -> body 360 -> label 360 - 24 of padding.
        assert_eq!(r.rects["0/0/0"].rect.width, 360.0);
        assert_eq!(r.rects["0/0/0/0"].rect.width, 360.0);
        assert_eq!(r.rects["0/0/0/0/0"].rect.width, 336.0);
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

    // --- UITableLayout -------------------------------------------------------
    //
    // Every number below was read off the engine (Studio, Edit datamodel): a
    // 400x300 frame holding a UITableLayout with Padding {0,10},{0,5} and the
    // cell sizes each test names.

    fn table(props: &[(&str, PropertyValue)]) -> SceneNode {
        let mut t = with(
            "UITableLayout",
            "Table",
            &[
                ("Padding", udim2(0.0, 10.0, 0.0, 5.0)),
                ("SortOrder", enum_item("SortOrder", "LayoutOrder")),
            ],
        );
        for (k, v) in props {
            t.properties.insert((*k).into(), v.clone());
        }
        t
    }

    /// A table container holding `rows` of cell sizes, in source order.
    fn table_of(t: SceneNode, rows: &[&[(f64, f64)]]) -> SceneNode {
        let mut container = with("Frame", "Table", &[("Size", udim2(0.0, 400.0, 0.0, 300.0))]);
        container.children.push(t);
        for (r, cells) in rows.iter().enumerate() {
            let mut line = with("Frame", &format!("L{r}"), &[("LayoutOrder", int(r as i64))]);
            for (c, &(w, h)) in cells.iter().enumerate() {
                line.children.push(with(
                    "Frame",
                    &format!("L{r}C{c}"),
                    &[
                        ("Size", udim2(0.0, w, 0.0, h)),
                        ("LayoutOrder", int(c as i64)),
                    ],
                ));
            }
            container.children.push(line);
        }
        container
    }

    const TABLE_CELLS: [&[(f64, f64)]; 2] = [
        &[(50.0, 20.0), (80.0, 40.0), (30.0, 10.0)],
        &[(70.0, 30.0), (40.0, 25.0), (60.0, 15.0)],
    ];

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "expected {b}, got {a}");
    }

    #[test]
    fn table_columns_take_the_widest_cell_and_rows_the_tallest() {
        let r = compute_layout(&screen(vec![table_of(table(&[]), &TABLE_CELLS)]), VP).unwrap();
        // Columns max(50,70)=70, max(80,40)=80, max(30,60)=60; rows 40 and 30.
        // A row frame spans the whole table (70+80+60 + 2 gaps = 230) and its
        // own height, which is what the engine reports for it.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 230.0,
                height: 40.0
            }
        );
        assert_eq!(
            r.rects["0/0/1"].rect,
            Rect {
                x: 0.0,
                y: 45.0,
                width: 230.0,
                height: 30.0
            }
        );
        // Cells land on the track intersections, not at their own size.
        assert_eq!(
            r.rects["0/0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 70.0,
                height: 40.0
            }
        );
        assert_eq!(
            r.rects["0/0/0/1"].rect,
            Rect {
                x: 80.0,
                y: 0.0,
                width: 80.0,
                height: 40.0
            }
        );
        assert_eq!(
            r.rects["0/0/0/2"].rect,
            Rect {
                x: 170.0,
                y: 0.0,
                width: 60.0,
                height: 40.0
            }
        );
        assert_eq!(
            r.rects["0/0/1/0"].rect,
            Rect {
                x: 0.0,
                y: 45.0,
                width: 70.0,
                height: 30.0
            }
        );
    }

    #[test]
    fn table_column_major_reads_children_as_columns() {
        let t = table(&[("MajorAxis", enum_item("TableMajorAxis", "ColumnMajor"))]);
        let r = compute_layout(&screen(vec![table_of(t, &TABLE_CELLS)]), VP).unwrap();
        // Now child 0 is a column: 80 wide (its widest cell), full table height.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 80.0,
                height: 95.0
            }
        );
        assert_eq!(
            r.rects["0/0/1"].rect,
            Rect {
                x: 90.0,
                y: 0.0,
                width: 70.0,
                height: 95.0
            }
        );
        // Row heights are the max across columns: 30, 40, 15.
        assert_eq!(
            r.rects["0/0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 80.0,
                height: 30.0
            }
        );
        assert_eq!(
            r.rects["0/0/0/1"].rect,
            Rect {
                x: 0.0,
                y: 35.0,
                width: 80.0,
                height: 40.0
            }
        );
        assert_eq!(
            r.rects["0/0/1/2"].rect,
            Rect {
                x: 90.0,
                y: 80.0,
                width: 70.0,
                height: 15.0
            }
        );
    }

    #[test]
    fn table_fill_scales_tracks_proportionally() {
        let t = table(&[
            (
                "FillEmptySpaceColumns",
                PropertyValue::Known(KnownProperty::Bool(true)),
            ),
            (
                "FillEmptySpaceRows",
                PropertyValue::Known(KnownProperty::Bool(true)),
            ),
        ]);
        let r = compute_layout(&screen(vec![table_of(t, &TABLE_CELLS)]), VP).unwrap();
        // 400 wide less two 10px gaps = 380, split in the 70:80:60 proportion.
        close(r.rects["0/0/0/0"].rect.width, 70.0 * 380.0 / 210.0);
        close(r.rects["0/0/0/1"].rect.width, 80.0 * 380.0 / 210.0);
        close(r.rects["0/0/0/2"].rect.width, 60.0 * 380.0 / 210.0);
        // 300 tall less one 5px gap = 295, split 40:30.
        close(r.rects["0/0/0/0"].rect.height, 40.0 * 295.0 / 70.0);
        close(r.rects["0/0/1/0"].rect.height, 30.0 * 295.0 / 70.0);
        // The filled table spans the container exactly.
        close(
            r.rects["0/0/0/2"].rect.x + r.rects["0/0/0/2"].rect.width,
            400.0,
        );
    }

    #[test]
    fn table_fill_also_shrinks_a_table_that_overruns() {
        // Two 120px cells in a 100px box with a 10px gap came out 45px each.
        let t = table(&[(
            "FillEmptySpaceColumns",
            PropertyValue::Known(KnownProperty::Bool(true)),
        )]);
        let mut container = with("Frame", "Table", &[("Size", udim2(0.0, 100.0, 0.0, 60.0))]);
        container.children.push(t);
        let mut line = with("Frame", "R", &[]);
        for c in 0..2 {
            line.children.push(with(
                "Frame",
                &format!("C{c}"),
                &[
                    ("Size", udim2(0.0, 120.0, 0.0, 80.0)),
                    ("LayoutOrder", int(c)),
                ],
            ));
        }
        container.children.push(line);
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        close(r.rects["0/0/0/0"].rect.width, 45.0);
        close(r.rects["0/0/0/1"].rect.x, 55.0);
        close(r.rects["0/0/0/1"].rect.width, 45.0);
    }

    #[test]
    fn table_hidden_cell_collapses_its_column_and_gap() {
        // Cells 40/80/120 wide with the middle one hidden: the engine gives the
        // visible pair one gap between them, not two, and no column at all for
        // the hidden cell — which keeps its own Position inside the row.
        let mut container = with("Frame", "Table", &[("Size", udim2(0.0, 400.0, 0.0, 200.0))]);
        container.children.push(table(&[]));
        let mut line = with("Frame", "R", &[]);
        for c in 0..3 {
            let mut cell = with(
                "Frame",
                &format!("C{c}"),
                &[
                    ("Size", udim2(0.0, 40.0 * (c + 1) as f64, 0.0, 20.0)),
                    ("LayoutOrder", int(c)),
                ],
            );
            if c == 1 {
                cell.properties.insert(
                    "Visible".into(),
                    PropertyValue::Known(KnownProperty::Bool(false)),
                );
            }
            line.children.push(cell);
        }
        container.children.push(line);
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0/0"].rect.width, 170.0); // 40 + 10 + 120
        assert_eq!(r.rects["0/0/0/0"].rect.width, 40.0);
        assert_eq!(r.rects["0/0/0/2"].rect.x, 50.0);
        assert_eq!(r.rects["0/0/0/2"].rect.width, 120.0);
        // The hidden cell still gets a rect (the renderer hides it), at its own size.
        assert_eq!(
            r.rects["0/0/0/1"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 80.0,
                height: 20.0
            }
        );
    }

    #[test]
    fn table_scale_cells_resolve_against_the_table_and_empty_rows_keep_a_gap() {
        let mut container = with("Frame", "Table", &[("Size", udim2(0.0, 400.0, 0.0, 200.0))]);
        container.children.push(table(&[]));
        let mut row_a = with("Frame", "A", &[("LayoutOrder", int(0))]);
        row_a.children.push(with(
            "Frame",
            "AC0",
            &[
                ("Size", udim2(0.25, 0.0, 0.0, 30.0)),
                ("LayoutOrder", int(0)),
            ],
        ));
        row_a.children.push(with(
            "Frame",
            "AC1",
            &[
                ("Size", udim2(0.0, 60.0, 0.5, 0.0)),
                ("LayoutOrder", int(1)),
            ],
        ));
        container.children.push(row_a);
        container
            .children
            .push(with("Frame", "B", &[("LayoutOrder", int(1))])); // empty row
        let mut row_c = with("Frame", "C", &[("LayoutOrder", int(2))]);
        row_c.children.push(with(
            "Frame",
            "CC0",
            &[
                ("Size", udim2(0.0, 40.0, 0.0, 20.0)),
                ("LayoutOrder", int(0)),
            ],
        ));
        container.children.push(row_c);
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        // 0.25 of the TABLE's width (not the row's) = 100; 0.5 of its height = 100.
        assert_eq!(r.rects["0/0/0/0"].rect.width, 100.0);
        assert_eq!(r.rects["0/0/0"].rect.height, 100.0);
        // The empty row is 0 tall but still takes a gap on each side.
        assert_eq!(r.rects["0/0/1"].rect.height, 0.0);
        assert_eq!(r.rects["0/0/1"].rect.y, 105.0);
        assert_eq!(r.rects["0/0/2"].rect.y, 110.0);
        // …and column 0 is still the widest cell anywhere in it.
        assert_eq!(r.rects["0/0/2/0"].rect.width, 100.0);
    }

    #[test]
    fn table_grows_an_automatic_size_parent_to_its_natural_extent() {
        let mut container = with(
            "Frame",
            "Table",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 0.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
            ],
        );
        let mut inner = table_of(table(&[]), &TABLE_CELLS);
        inner.properties.remove("Size");
        for child in inner.children.drain(..) {
            container.children.push(child);
        }
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 230.0);
        assert_eq!(r.rects["0/0"].rect.height, 75.0); // 40 + 5 + 30
    }

    // --- UIPageLayout --------------------------------------------------------

    fn pager(props: &[(&str, PropertyValue)], pages: &[(f64, f64)]) -> SceneNode {
        let mut layout = with(
            "UIPageLayout",
            "Pages",
            &[("SortOrder", enum_item("SortOrder", "LayoutOrder"))],
        );
        for (k, v) in props {
            layout.properties.insert((*k).into(), v.clone());
        }
        let mut container = with(
            "Frame",
            "Pager",
            &[
                ("Size", udim2(0.0, 400.0, 0.0, 300.0)),
                (
                    "ClipsDescendants",
                    PropertyValue::Known(KnownProperty::Bool(true)),
                ),
            ],
        );
        container.children.push(layout);
        for (i, &(w, h)) in pages.iter().enumerate() {
            container.children.push(with(
                "Frame",
                &format!("P{i}"),
                &[
                    ("Size", udim2(0.0, w, 0.0, h)),
                    ("LayoutOrder", int(i as i64)),
                ],
            ));
        }
        container
    }

    #[test]
    fn page_layout_strides_by_the_container_plus_padding() {
        // Studio: a 400x300 pager with Padding {0,20} put page 2 a full 420 out,
        // and left each page at its own size rather than stretching it.
        let r = compute_layout(
            &screen(vec![pager(
                &[("Padding", udim(0.0, 20.0))],
                &[(10.0, 10.0), (10.0, 10.0), (10.0, 10.0)],
            )]),
            VP,
        )
        .unwrap();
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 10.0
            }
        );
        assert_eq!(r.rects["0/0/1"].rect.x, 420.0);
        assert_eq!(r.rects["0/0/2"].rect.x, 840.0);
    }

    #[test]
    fn page_layout_puts_the_current_page_in_the_container() {
        let r = compute_layout(
            &screen(vec![pager(
                &[("Padding", udim(0.0, 20.0)), ("CurrentPageIndex", int(1))],
                &[(10.0, 10.0), (10.0, 10.0), (10.0, 10.0)],
            )]),
            VP,
        )
        .unwrap();
        assert_eq!(r.rects["0/0/0"].rect.x, -420.0);
        assert_eq!(r.rects["0/0/1"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/2"].rect.x, 420.0);
    }

    #[test]
    fn page_layout_fills_vertically_and_aligns_on_both_axes() {
        // Studio: centered 100x50 pages in a 400x300 container sat at +150/+125,
        // and a vertical fill strode down by 320 with x left alone.
        let r = compute_layout(
            &screen(vec![pager(
                &[
                    ("Padding", udim(0.0, 20.0)),
                    ("FillDirection", enum_item("FillDirection", "Vertical")),
                    (
                        "HorizontalAlignment",
                        enum_item("HorizontalAlignment", "Center"),
                    ),
                    (
                        "VerticalAlignment",
                        enum_item("VerticalAlignment", "Center"),
                    ),
                    ("CurrentPageIndex", int(1)),
                ],
                &[(100.0, 50.0), (100.0, 50.0)],
            )]),
            VP,
        )
        .unwrap();
        assert_eq!(
            r.rects["0/0/1"].rect,
            Rect {
                x: 150.0,
                y: 125.0,
                width: 100.0,
                height: 50.0
            }
        );
        assert_eq!(r.rects["0/0/0"].rect.x, 150.0);
        assert_eq!(r.rects["0/0/0"].rect.y, 125.0 - 320.0);
    }

    #[test]
    fn page_layout_clamps_an_out_of_range_page() {
        let r = compute_layout(
            &screen(vec![pager(
                &[("CurrentPageIndex", int(9))],
                &[(10.0, 10.0), (10.0, 10.0)],
            )]),
            VP,
        )
        .unwrap();
        // Clamped to the last page, which is the one in the container.
        assert_eq!(r.rects["0/0/1"].rect.x, 0.0);
        assert_eq!(r.rects["0/0/0"].rect.x, -400.0);
    }

    #[test]
    fn sort_order_defaults_to_name_like_the_engine() {
        // A fresh UIListLayout reads Enum.SortOrder.Name in Studio, so children
        // flow alphabetically until the tree says otherwise.
        let list = with("UIListLayout", "List", &[]);
        let mut container = with("Frame", "Container", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]);
        container.children.push(list);
        for name in ["Bee", "Ant", "Cat"] {
            container.children.push(with(
                "Frame",
                name,
                &[("Size", udim2(0.0, 50.0, 0.0, 20.0))],
            ));
        }
        let r = compute_layout(&screen(vec![container]), VP).unwrap();
        assert_eq!(r.rects["0/0/1"].rect.y, 0.0); // Ant
        assert_eq!(r.rects["0/0/0"].rect.y, 20.0); // Bee
        assert_eq!(r.rects["0/0/2"].rect.y, 40.0); // Cat
    }
    // --- UIScale -------------------------------------------------------------

    /// A `UIScale` child with the given `Scale`.
    fn ui_scale(v: f64) -> SceneNode {
        with("UIScale", "Scale", &[("Scale", num(v))])
    }

    #[test]
    fn ui_scale_multiplies_the_object_and_everything_under_it() {
        let child = with(
            "Frame",
            "Child",
            &[
                ("Size", udim2(0.0, 40.0, 0.0, 10.0)),
                ("Position", udim2(0.0, 10.0, 0.0, 5.0)),
            ],
        );
        let mut card = with(
            "Frame",
            "Card",
            &[
                ("Size", udim2(0.0, 200.0, 0.0, 100.0)),
                ("Position", udim2(0.0, 50.0, 0.0, 20.0)),
            ],
        );
        card.children = vec![ui_scale(2.0), child];
        let r = compute_layout(&screen(vec![card]), VP).unwrap();
        // The card itself doubles — a UIScale is not only about its descendants —
        // but it does not move: its parent already decided where it goes.
        assert_eq!(
            r.rects["0/0"].rect,
            Rect {
                x: 50.0,
                y: 20.0,
                width: 400.0,
                height: 200.0
            }
        );
        // The child's own offsets double with it, size and position alike, so the
        // subtree is the same picture drawn twice as big.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 70.0,
                y: 30.0,
                width: 80.0,
                height: 20.0
            }
        );
        // The UIScale is a modifier: no rect of its own, and no positional id spent.
        assert!(!r.rects.contains_key("0/0/1"));
    }

    #[test]
    fn ui_scale_scales_padding_and_list_gaps() {
        let mut card = with("Frame", "Card", &[("Size", udim2(0.0, 300.0, 0.0, 400.0))]);
        card.children = vec![
            ui_scale(1.5),
            with(
                "UIPadding",
                "Pad",
                &[
                    ("PaddingLeft", udim(0.0, 10.0)),
                    ("PaddingTop", udim(0.0, 10.0)),
                ],
            ),
            with(
                "UIListLayout",
                "List",
                &[
                    ("FillDirection", enum_item("FillDirection", "Vertical")),
                    ("Padding", udim(0.0, 8.0)),
                ],
            ),
        ];
        for name in ["A", "B", "C"] {
            card.children.push(with(
                "Frame",
                name,
                &[("Size", udim2(0.0, 50.0, 0.0, 20.0))],
            ));
        }
        let r = compute_layout(&screen(vec![card]), VP).unwrap();
        assert_eq!(r.rects["0/0"].rect.width, 450.0);
        assert_eq!(r.rects["0/0"].rect.height, 600.0);
        // 10px of padding is 15 real px, 50x20 items are 75x30, and the 8px gap is 12.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 15.0,
                y: 15.0,
                width: 75.0,
                height: 30.0
            }
        );
        assert_eq!(r.rects["0/0/1"].rect.y, 57.0);
        assert_eq!(r.rects["0/0/2"].rect.y, 99.0);
    }

    #[test]
    fn nested_ui_scales_multiply() {
        let mut inner = with("Frame", "Inner", &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]);
        inner.children = vec![
            ui_scale(1.5),
            with(
                "Frame",
                "Leaf",
                &[
                    ("Size", udim2(0.0, 10.0, 0.0, 10.0)),
                    ("Position", udim2(0.0, 4.0, 0.0, 0.0)),
                ],
            ),
        ];
        let mut outer = with("Frame", "Outer", &[("Size", udim2(0.0, 400.0, 0.0, 300.0))]);
        outer.children = vec![ui_scale(2.0), inner];
        let r = compute_layout(&screen(vec![outer]), VP).unwrap();
        // 2 above and 1.5 of its own: the inner frame renders at 3x its written size.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 150.0
            }
        );
        // And so does everything below it — 10px square at x=4 becomes 30 at x=12.
        assert_eq!(
            r.rects["0/0/0/0"].rect,
            Rect {
                x: 12.0,
                y: 0.0,
                width: 30.0,
                height: 30.0
            }
        );
    }

    #[test]
    fn ui_scale_grows_an_automatic_size_parent_by_the_scale() {
        let mut card = with(
            "Frame",
            "Card",
            &[("AutomaticSize", enum_item("AutomaticSize", "XY"))],
        );
        card.children = vec![
            ui_scale(2.0),
            with(
                "UIPadding",
                "Pad",
                &[
                    ("PaddingLeft", udim(0.0, 5.0)),
                    ("PaddingRight", udim(0.0, 5.0)),
                    ("PaddingTop", udim(0.0, 5.0)),
                    ("PaddingBottom", udim(0.0, 5.0)),
                ],
            ),
            with("Frame", "Child", &[("Size", udim2(0.0, 60.0, 0.0, 30.0))]),
        ];
        let r = compute_layout(&screen(vec![card]), VP).unwrap();
        // The card hugs what it actually renders: a 120x60 child inside 10px insets,
        // not the 60x30 plus 5px the scene text says.
        assert_eq!(
            r.rects["0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 140.0,
                height: 80.0
            }
        );
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 10.0,
                y: 10.0,
                width: 120.0,
                height: 60.0
            }
        );
    }

    #[test]
    fn a_scaled_auto_size_still_stops_at_the_room_its_parent_has() {
        let mut card = with(
            "Frame",
            "Card",
            &[
                ("Size", udim2(0.0, 0.0, 0.0, 40.0)),
                ("AutomaticSize", enum_item("AutomaticSize", "X")),
            ],
        );
        card.children = vec![
            ui_scale(2.0),
            with("Frame", "Child", &[("Size", udim2(0.0, 150.0, 0.0, 20.0))]),
        ];
        let mut column = with(
            "Frame",
            "Column",
            &[("Size", udim2(0.0, 200.0, 0.0, 400.0))],
        );
        column.children = vec![card];
        let r = compute_layout(&screen(vec![column]), VP).unwrap();
        // The scaled content wants 300; the column only has 200, and the ceiling is
        // in real pixels, so the grown axis clamps there. The explicit height is the
        // one part the scale still doubles.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 200.0,
                height: 80.0
            }
        );
        // The child keeps its scaled size and overflows, exactly as it would with no
        // scale and a 300px child — clamping the parent is not clamping the content.
        assert_eq!(r.rects["0/0/0/0"].rect.width, 300.0);
    }

    #[test]
    fn ui_scale_multiplies_a_size_constraint() {
        let mut own = with("Frame", "Own", &[("Size", udim2(0.0, 500.0, 0.0, 100.0))]);
        own.children = vec![
            ui_scale(2.0),
            with(
                "UISizeConstraint",
                "Limit",
                &[("MaxSize", vector2(300.0, 80.0))],
            ),
        ];

        let mut constrained = with(
            "Frame",
            "Constrained",
            &[("Size", udim2(0.0, 10.0, 0.0, 10.0))],
        );
        constrained.children = vec![with(
            "UISizeConstraint",
            "Floor",
            &[("MinSize", vector2(100.0, 20.0))],
        )];
        let mut host = with("Frame", "Host", &[("Size", udim2(0.0, 400.0, 0.0, 300.0))]);
        host.children = vec![ui_scale(2.0), constrained];

        let r = compute_layout(&screen(vec![own, host]), VP).unwrap();
        // The clamp applies to the size the object asked for; its own scale multiplies
        // the clamped result, so a Scale tween still moves a fully-constrained box.
        assert_eq!(
            r.rects["0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 600.0,
                height: 160.0
            }
        );
        // A bound inherited from a scale above is a scaled bound: 100x20 of floor in a
        // doubled subtree is 200x40, so the box stays in proportion with its siblings.
        assert_eq!(
            r.rects["0/1/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 200.0,
                height: 40.0
            }
        );
    }

    #[test]
    fn ui_scale_scales_a_grids_default_cells() {
        let mut board = with("Frame", "Board", &[("Size", udim2(0.0, 400.0, 0.0, 300.0))]);
        board.children = vec![
            ui_scale(2.0),
            with("UIGridLayout", "Grid", &[]),
            frame("A"),
            frame("B"),
        ];
        let r = compute_layout(&screen(vec![board]), VP).unwrap();
        // Default CellSize {0,100} and CellPadding {0,5} are offsets like any other:
        // 200px cells 10px apart in an 800x600 board.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 200.0,
                height: 200.0
            }
        );
        assert_eq!(r.rects["0/0/1"].rect.x, 210.0);
    }

    #[test]
    fn ui_scale_scales_measured_text_bounds() {
        let mut label = with(
            "TextLabel",
            "Label",
            &[
                ("AutomaticSize", enum_item("AutomaticSize", "XY")),
                ("TextBounds", vector2(60.0, 18.0)),
            ],
        );
        label.children = vec![ui_scale(1.5)];
        let r = compute_layout(&screen(vec![label]), VP).unwrap();
        // The adapter measures the text at its own TextSize, knowing nothing of the
        // scale above it, so the label has to hug 1.5x what it was handed.
        assert_eq!(
            r.rects["0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 90.0,
                height: 27.0
            }
        );
    }

    #[test]
    fn ui_scale_scales_a_scrolling_canvas() {
        let mut scroll = with(
            "ScrollingFrame",
            "Scroll",
            &[
                ("Size", udim2(0.0, 200.0, 0.0, 200.0)),
                ("CanvasSize", udim2(0.0, 0.0, 0.0, 300.0)),
            ],
        );
        scroll.children = vec![
            ui_scale(2.0),
            with("Frame", "Item", &[("Size", udim2(1.0, 0.0, 1.0, 0.0))]),
        ];
        let r = compute_layout(&screen(vec![scroll]), VP).unwrap();
        // A 300px canvas in a doubled frame is 600px of scrollable content, against a
        // 400px window — the scroll bar has to survive the scale.
        assert_eq!(
            r.rects["0/0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 400.0,
                height: 600.0
            }
        );
    }

    #[test]
    fn a_scale_tween_grows_a_centred_button_about_its_own_middle() {
        let mut button = with(
            "TextButton",
            "Button",
            &[
                ("Size", udim2(0.0, 100.0, 0.0, 40.0)),
                ("Position", udim2(0.5, 0.0, 0.5, 0.0)),
                ("AnchorPoint", vector2(0.5, 0.5)),
            ],
        );
        button.children = vec![ui_scale(1.25)];
        let r = compute_layout(&screen(vec![button]), VP).unwrap();
        let rect = r.rects["0/0"].rect;
        assert_eq!(
            rect,
            Rect {
                x: 337.5,
                y: 275.0,
                width: 125.0,
                height: 50.0
            }
        );
        // The anchor point is what re-centres it: the hover "pop" idiom grows the
        // button in place instead of sliding it down and to the right.
        assert_eq!(rect.x + rect.width / 2.0, 400.0);
        assert_eq!(rect.y + rect.height / 2.0, 300.0);
    }

    #[test]
    fn a_ui_scale_defaults_to_one_and_never_goes_negative() {
        let mut plain = with("Frame", "Plain", &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]);
        plain.children = vec![with("UIScale", "Scale", &[])];
        let mut inverted = with(
            "Frame",
            "Inverted",
            &[("Size", udim2(0.0, 100.0, 0.0, 50.0))],
        );
        inverted.children = vec![ui_scale(-2.0)];
        let r = compute_layout(&screen(vec![plain, inverted]), VP).unwrap();
        // Roblox's own default Scale is 1, so a UIScale nobody has written to yet is
        // not a subtree collapsed to nothing.
        assert_eq!(r.rects["0/0"].rect.width, 100.0);
        assert_eq!(r.rects["0/0"].rect.height, 50.0);
        // A negative scale has no meaning for a box with a width; it collapses.
        assert_eq!(r.rects["0/1"].rect.width, 0.0);
        assert_eq!(r.rects["0/1"].rect.height, 0.0);
    }

    #[test]
    fn a_container_assigned_extent_outranks_a_childs_own_scale() {
        // The documented compromise (see the module header): a grid hands its cell
        // size down, so the cell is the cell — but everything inside the scaled
        // child still renders at 2x. Pinned here so the day it can be checked
        // against a running engine, the disagreement is a failing test rather than
        // a silent one.
        let mut cell = frame("A");
        cell.children = vec![
            ui_scale(2.0),
            with("Frame", "Inside", &[("Size", udim2(0.0, 20.0, 0.0, 20.0))]),
        ];
        let mut board = with("Frame", "Board", &[("Size", udim2(0.0, 400.0, 0.0, 300.0))]);
        board.children = vec![
            with(
                "UIGridLayout",
                "Grid",
                &[("CellSize", udim2(0.0, 100.0, 0.0, 100.0))],
            ),
            cell,
        ];
        let r = compute_layout(&screen(vec![board]), VP).unwrap();
        assert_eq!(r.rects["0/0/0"].rect.width, 100.0);
        assert_eq!(r.rects["0/0/0/0"].rect.width, 40.0);
    }

    #[test]
    fn a_ui_scale_on_the_root_scales_what_is_inside_it() {
        let r = compute_layout(
            &screen(vec![
                ui_scale(2.0),
                with("Frame", "Card", &[("Size", udim2(0.0, 100.0, 0.0, 50.0))]),
            ]),
            VP,
        )
        .unwrap();
        // The top node is the viewport by fiat, so there is no size of its own left
        // to multiply — but everything it holds still scales.
        assert_eq!(r.rects["0"].rect.width, 800.0);
        assert_eq!(r.rects["0"].rect.height, 600.0);
        assert_eq!(
            r.rects["0/0"].rect,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 200.0,
                height: 100.0
            }
        );
    }
}
