//! Loom Scene IR.
//!
//! The framework-agnostic representation of a Roblox GUI instance tree, plus the
//! shared layout I/O types. Every frontend adapter (`@rbxts/react`, later
//! `vide`/`luau`) produces this IR; the layout engine and DOM renderer consume
//! it. It is the single contract that keeps the rendering pipeline decoupled
//! from any one frontend. Keep this in sync with the `@loom-dev/scene` TS mirror.
//!
//! Design notes (from the M1 design panel, empirically verified):
//! - Datatypes are plain untagged structs with lowercase keys; tagging happens
//!   one level up at the property-value layer.
//! - A property value is adjacently tagged `{ "type": <tag>, "value": <payload> }`.
//!   [`PropertyValue`] is an `untagged` wrapper of [`KnownProperty`] plus an
//!   `Unknown(serde_json::Value)` arm so a newer adapter's property degrades to a
//!   default instead of erroring the whole tree (a plain `#[serde(other)]` arm
//!   cannot do this — it errors on tags that carry content).
//! - Numbers are f64 for clean JS/JSON interop. The `int` tag uses a truncating
//!   deserializer so `serde_json` and `serde-wasm-bindgen` accept whole-valued
//!   doubles identically.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Datatypes (plain, untagged; lowercase keys; byte-identical Rust <-> TS).
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct UDim {
    pub scale: f64,
    pub offset: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct UDim2 {
    pub x: UDim,
    pub y: UDim,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Vector2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Color3 {
    /// 0..=1 (NOT 0..255).
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

impl UDim {
    pub const ZERO: UDim = UDim {
        scale: 0.0,
        offset: 0.0,
    };
}
impl UDim2 {
    pub const ZERO: UDim2 = UDim2 {
        x: UDim::ZERO,
        y: UDim::ZERO,
    };
}
impl Vector2 {
    pub const ZERO: Vector2 = Vector2 { x: 0.0, y: 0.0 };
}
impl Color3 {
    /// `Color3.fromRGB(163, 162, 165)` — the real Roblox GuiObject default background.
    pub const DEFAULT_GUI_BG: Color3 = Color3 {
        r: 163.0 / 255.0,
        g: 162.0 / 255.0,
        b: 165.0 / 255.0,
    };
}

// ---------------------------------------------------------------------------
// Property values.
// ---------------------------------------------------------------------------

/// The KNOWN, adjacently-tagged property values: `{ "type": <tag>, "value": <payload> }`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum KnownProperty {
    UDim2(UDim2),
    UDim(UDim),
    Vector2(Vector2),
    Color3(Color3),
    EnumItem(EnumItem),
    #[serde(rename = "number")]
    Number(f64),
    /// Truncating deserializer so both `serde_json` and `serde-wasm-bindgen` accept
    /// whole-valued doubles (JS has no int/float distinction). `2`, `2.0`, `-1.5`
    /// all parse; `-1.5 -> -1`, matching JS `Math.trunc` for in-range values.
    /// Non-finite or out-of-i64-range inputs are rejected, so the untagged
    /// `PropertyValue` degrades them to `Unknown` (= default) rather than
    /// saturating and diverging from JS.
    #[serde(rename = "int", deserialize_with = "de_i64")]
    Int(i64),
    #[serde(rename = "bool")]
    Bool(bool),
    #[serde(rename = "string")]
    Str(String),
}

// i64 range as f64 is the half-open interval [-2^63, 2^63).
const I64_MIN_F64: f64 = -9_223_372_036_854_775_808.0;
const I64_2POW63_F64: f64 = 9_223_372_036_854_775_808.0;

/// Truncate an f64 to i64, returning `None` for non-finite or out-of-range inputs.
/// Rust's `as` cast saturates where JS `Math.trunc` does not, so we reject those
/// cases on both sides instead of letting the two languages disagree.
fn i64_from_f64(f: f64) -> Option<i64> {
    (f.is_finite() && (I64_MIN_F64..I64_2POW63_F64).contains(&f)).then(|| f.trunc() as i64)
}

fn de_i64<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    use serde::de::Error;
    let f = f64::deserialize(d)?;
    i64_from_f64(f).ok_or_else(|| Error::custom(format!("int out of i64 range: {f}")))
}

/// A Roblox `Enum` item, e.g. `Enum.FillDirection.Vertical`. The layout engine
/// matches on `name`; `value` is kept for fidelity.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EnumItem {
    #[serde(rename = "enumType")]
    pub enum_type: String,
    pub name: String,
    /// Roblox enum numeric value, kept for fidelity (the engine matches on `name`).
    /// An f64 so a malformed/out-of-range `value` never discards the whole item
    /// (and its valid `name`) — unlike a rejecting `int` deserializer.
    #[serde(default)]
    pub value: f64,
}

/// A property value. Forward-compatible: serde tries [`KnownProperty`] first; any
/// unrecognized tag falls into `Unknown`, holding the raw `{type,value}` object,
/// which never errors and round-trips losslessly. Typed getters return `None` for
/// it, so consumers fall back to the Roblox default.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PropertyValue {
    Known(KnownProperty),
    Unknown(serde_json::Value),
}

impl PropertyValue {
    fn known(&self) -> Option<&KnownProperty> {
        match self {
            PropertyValue::Known(k) => Some(k),
            PropertyValue::Unknown(_) => None,
        }
    }

    pub fn as_udim2(&self) -> Option<UDim2> {
        match self.known()? {
            KnownProperty::UDim2(v) => Some(*v),
            _ => None,
        }
    }
    pub fn as_vector2(&self) -> Option<Vector2> {
        match self.known()? {
            KnownProperty::Vector2(v) => Some(*v),
            _ => None,
        }
    }
    pub fn as_color3(&self) -> Option<Color3> {
        match self.known()? {
            KnownProperty::Color3(v) => Some(*v),
            _ => None,
        }
    }
    pub fn as_udim(&self) -> Option<UDim> {
        match self.known()? {
            KnownProperty::UDim(v) => Some(*v),
            _ => None,
        }
    }
    pub fn as_enum(&self) -> Option<&EnumItem> {
        match self.known()? {
            KnownProperty::EnumItem(v) => Some(v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self.known()? {
            KnownProperty::Str(v) => Some(v.as_str()),
            _ => None,
        }
    }
    /// `number` and `int` cross-coerce (so e.g. ZIndex tolerates either tag).
    pub fn as_number(&self) -> Option<f64> {
        match self.known()? {
            KnownProperty::Number(v) => Some(*v),
            KnownProperty::Int(v) => Some(*v as f64),
            _ => None,
        }
    }
    pub fn as_int(&self) -> Option<i64> {
        match self.known()? {
            KnownProperty::Int(v) => Some(*v),
            KnownProperty::Number(v) => i64_from_f64(*v),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self.known()? {
            KnownProperty::Bool(v) => Some(*v),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Scene node.
// ---------------------------------------------------------------------------

/// A single node in the Roblox GUI instance tree. Class-agnostic: a free-string
/// `class_name`, a `name`, an optional stable `id`, an open property bag (keys are
/// Roblox PascalCase), and ordered children inline.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SceneNode {
    #[serde(rename = "className")]
    pub class_name: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, PropertyValue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<SceneNode>,
}

impl SceneNode {
    pub fn new(class_name: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            class_name: class_name.into(),
            name: name.into(),
            id: None,
            properties: BTreeMap::new(),
            children: Vec::new(),
        }
    }

    // Convenience accessors with Roblox defaults baked in.
    pub fn size(&self) -> UDim2 {
        self.properties
            .get("Size")
            .and_then(PropertyValue::as_udim2)
            .unwrap_or(UDim2::ZERO)
    }
    pub fn position(&self) -> UDim2 {
        self.properties
            .get("Position")
            .and_then(PropertyValue::as_udim2)
            .unwrap_or(UDim2::ZERO)
    }
    pub fn anchor_point(&self) -> Vector2 {
        self.properties
            .get("AnchorPoint")
            .and_then(PropertyValue::as_vector2)
            .unwrap_or(Vector2::ZERO)
    }
    pub fn visible(&self) -> bool {
        self.properties
            .get("Visible")
            .and_then(PropertyValue::as_bool)
            .unwrap_or(true)
    }
    pub fn z_index(&self) -> i64 {
        self.properties
            .get("ZIndex")
            .and_then(PropertyValue::as_int)
            .unwrap_or(1)
    }
    pub fn background_color3(&self) -> Color3 {
        self.properties
            .get("BackgroundColor3")
            .and_then(PropertyValue::as_color3)
            .unwrap_or(Color3::DEFAULT_GUI_BG)
    }
    pub fn background_transparency(&self) -> f64 {
        self.properties
            .get("BackgroundTransparency")
            .and_then(PropertyValue::as_number)
            .unwrap_or(0.0)
    }
}

// ---------------------------------------------------------------------------
// Class registry — the single extension point (mirrors old loom metadata.json).
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClassMeta {
    pub is_layer_collector: bool,
    pub participates_in_layout: bool,
}

pub fn class_meta(class_name: &str) -> ClassMeta {
    match class_name {
        "ScreenGui" | "SurfaceGui" | "BillboardGui" => ClassMeta {
            is_layer_collector: true,
            participates_in_layout: true,
        },
        // Non-layout modifiers (participatesInLayout:false). Arrive as child nodes.
        "UICorner"
        | "UIPadding"
        | "UIListLayout"
        | "UIGridLayout"
        | "UIStroke"
        | "UIShadow"
        | "UIScale"
        | "UIGradient"
        | "UIPageLayout"
        | "UITableLayout"
        | "UISizeConstraint"
        | "UITextSizeConstraint"
        | "UIAspectRatioConstraint"
        | "UIFlexItem" => ClassMeta {
            is_layer_collector: false,
            participates_in_layout: false,
        },
        // Frame and every other GuiObject: painted, layout-participating.
        _ => ClassMeta {
            is_layer_collector: false,
            participates_in_layout: true,
        },
    }
}

pub fn is_layer_collector(class_name: &str) -> bool {
    class_meta(class_name).is_layer_collector
}
pub fn participates_in_layout(class_name: &str) -> bool {
    class_meta(class_name).participates_in_layout
}

// ---------------------------------------------------------------------------
// Layout I/O (shared by loom-layout and the wasm/native bindings).
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Per-node layout output. Open struct: later milestones add optional
/// `content_size`/`canvas_size`/`clipped` additively without a contract break.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct LayoutNode {
    pub rect: Rect,
    /// The product of every `UIScale` covering the node, its own included: how
    /// many real pixels one of its own scene pixels is worth. The rect already
    /// carries it; this is for what the painter sizes on its own — `TextSize`
    /// above all, which a `UIScale` enlarges along with the box. Omitted at 1.
    #[serde(default = "unit_scale", skip_serializing_if = "is_unit_scale")]
    pub scale: f64,
}

fn unit_scale() -> f64 {
    1.0
}

#[allow(clippy::trivially_copy_pass_by_ref, clippy::float_cmp)]
fn is_unit_scale(scale: &f64) -> bool {
    *scale == 1.0
}

/// Flat map from resolved node id -> [`LayoutNode`]. Wrapped in a struct to leave
/// room for a future `dirty_ids` field for incremental layout.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LayoutResult {
    pub rects: BTreeMap<String, LayoutNode>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_round_trips_through_json() {
        let v: PropertyValue =
			serde_json::from_str(r#"{"type":"UDim2","value":{"x":{"scale":0.5,"offset":0},"y":{"scale":0,"offset":40}}}"#).unwrap();
        assert_eq!(
            v.as_udim2(),
            Some(UDim2 {
                x: UDim {
                    scale: 0.5,
                    offset: 0.0
                },
                y: UDim {
                    scale: 0.0,
                    offset: 40.0
                }
            })
        );
    }

    #[test]
    fn unknown_tag_degrades_instead_of_erroring() {
        let json = r#"{"type":"Font","value":{"family":"Gotham"}}"#;
        let v: PropertyValue = serde_json::from_str(json).unwrap();
        assert!(matches!(v, PropertyValue::Unknown(_)));
        // Round-trips losslessly, and typed getters return None (=> default).
        assert_eq!(
            serde_json::to_value(&v).unwrap(),
            serde_json::from_str::<serde_json::Value>(json).unwrap()
        );
        assert_eq!(v.as_udim2(), None);
    }

    #[test]
    fn int_accepts_whole_valued_doubles_and_truncates_negatives() {
        let a: PropertyValue = serde_json::from_str(r#"{"type":"int","value":2}"#).unwrap();
        let b: PropertyValue = serde_json::from_str(r#"{"type":"int","value":2.0}"#).unwrap();
        let c: PropertyValue = serde_json::from_str(r#"{"type":"int","value":-1.5}"#).unwrap();
        assert_eq!(a.as_int(), Some(2));
        assert_eq!(b.as_int(), Some(2));
        assert_eq!(c.as_int(), Some(-1)); // matches JS Math.trunc(-1.5)
    }

    #[test]
    fn out_of_range_int_degrades_to_unknown() {
        // 1e30 exceeds i64; de_i64 rejects it, so the untagged value falls to Unknown
        // (=> default) rather than saturating and diverging from JS Math.trunc.
        let v: PropertyValue = serde_json::from_str(r#"{"type":"int","value":1e30}"#).unwrap();
        assert!(matches!(v, PropertyValue::Unknown(_)));
        assert_eq!(v.as_int(), None);
    }

    #[test]
    fn enum_item_survives_out_of_range_value() {
        // The engine keys on `name`; an out-of-range/odd `value` must not discard it
        // (value is an f64, so it never gates the parse).
        let v: PropertyValue = serde_json::from_str(
            r#"{"type":"EnumItem","value":{"enumType":"FillDirection","name":"Vertical","value":1e30}}"#,
        )
        .unwrap();
        assert_eq!(v.as_enum().map(|e| e.name.as_str()), Some("Vertical"));
    }

    #[test]
    fn sparse_node_deserializes_with_defaults() {
        let node: SceneNode =
            serde_json::from_str(r#"{"className":"Frame","name":"Bare"}"#).unwrap();
        assert!(node.properties.is_empty());
        assert!(node.children.is_empty());
        assert_eq!(node.size(), UDim2::ZERO);
        assert_eq!(node.visible(), true);
        assert_eq!(node.z_index(), 1);
        assert_eq!(node.background_color3(), Color3::DEFAULT_GUI_BG);
    }

    #[test]
    fn registry_classifies_roots_and_modifiers() {
        assert!(is_layer_collector("ScreenGui"));
        assert!(!is_layer_collector("Frame"));
        assert!(participates_in_layout("Frame"));
        assert!(!participates_in_layout("UIListLayout"));
        // Purely decorative, and it must agree with the TypeScript NON_LAYOUT
        // set: the two sides number layout-participating children to build node
        // ids, so one counting a modifier the other skips desynchronises every
        // id after it.
        assert!(!participates_in_layout("UIShadow"));
    }
}
