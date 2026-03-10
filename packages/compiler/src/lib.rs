mod preview_transform;

use napi_derive::napi;
use swc_core::{
    common::{sync::Lrc, FileName, SourceMap, DUMMY_SP},
    ecma::{
        ast::{
            Bool, CallExpr, Callee, Expr, ExprOrSpread, Ident, IdentName, JSXAttr, JSXAttrName,
            JSXAttrOrSpread, JSXAttrValue, JSXClosingElement, JSXElementName, JSXExpr,
            JSXExprContainer, JSXOpeningElement, KeyValueProp, Lit, Null, ObjectLit, Prop,
            PropName, PropOrSpread, Str,
        },
        codegen::{text_writer::JsWriter, Config as CodegenConfig, Emitter},
        parser::{parse_file_as_module, Syntax, TsSyntax},
        visit::{VisitMut, VisitMutWith},
    },
};

#[derive(Default)]
struct LatticeUITransformer;        

const RBX_STYLE_HELPER_NAME: &str = "__rbxStyle";

fn map_roblox_host_tag(tag: &str) -> Option<&'static str> {
    match tag {
        // Buttons
        "textbutton" | "imagebutton" => Some("button"),

        // Text input
        "textbox" => Some("input"),

        // Text display
        "textlabel" => Some("span"),

        // Container/decorator/layout/gui hosts
        "frame"
        | "scrollingframe"
        | "canvasgroup"
        | "imagelabel"
        | "viewportframe"
        | "videoframe"
        | "screengui"
        | "surfacegui"
        | "billboardgui"
        | "uicorner"
        | "uipadding"
        | "uilistlayout"
        | "uigridlayout"
        | "uistroke"
        | "uigradient"
        | "uipagelayout"
        | "uitablelayout"
        | "uiscale"
        | "uisizeconstraint"
        | "uitextsizeconstraint"
        | "uiaspectratioconstraint"
        | "uiflexitem" => Some("div"),

        _ => None,
    }
}

fn is_roblox_style_prop(name: &str) -> bool {
    matches!(
        name,
        "Size"
            | "Position"
            | "BackgroundColor3"
            | "BackgroundTransparency"
            | "AnchorPoint"
            | "ZIndex"
            | "Visible"
            | "BorderSizePixel"
            | "TextColor3"
            | "TextSize"
            | "TextTransparency"
            | "TextWrapped"
            | "TextXAlignment"
            | "TextYAlignment"
            | "Image"
            | "ImageColor3"
            | "ImageTransparency"
            | "CanvasSize"
            | "ScrollBarThickness"
            | "ScrollingDirection"
            | "AutomaticSize"
            | "FillDirection"
            | "HorizontalAlignment"
            | "VerticalAlignment"
            | "SortOrder"
            | "Padding"
            | "PaddingTop"
            | "PaddingBottom"
            | "PaddingLeft"
            | "PaddingRight"
            | "CornerRadius"
            | "Thickness"
            | "Transparency"
    )
}

fn jsx_attr_value_to_expr(value: Option<JSXAttrValue>) -> Expr {
    match value {
        Some(JSXAttrValue::JSXExprContainer(container)) => match container.expr {
            JSXExpr::Expr(expr) => *expr,
            JSXExpr::JSXEmptyExpr(_) => Expr::Lit(Lit::Null(Null { span: DUMMY_SP })),
        },
        Some(JSXAttrValue::Str(str_lit)) => Expr::Lit(Lit::Str(str_lit)),
        Some(JSXAttrValue::JSXElement(element)) => Expr::JSXElement(element),
        Some(JSXAttrValue::JSXFragment(fragment)) => Expr::JSXFragment(fragment),
        None => Expr::Lit(Lit::Bool(Bool {
            span: DUMMY_SP,
            value: true,
        })),
    }
}

impl VisitMut for LatticeUITransformer {
    fn visit_mut_jsx_opening_element(&mut self, el: &mut JSXOpeningElement) {
        el.visit_mut_children_with(self);

        if let JSXElementName::Ident(ident) = &mut el.name {
            let original_tag = ident.sym.to_string();

            if let Some(mapped_tag) = map_roblox_host_tag(&original_tag) {
                ident.sym = mapped_tag.into();

                let mut extracted_style_props: Vec<(String, Expr)> = Vec::new();
                let mut next_attrs = Vec::with_capacity(el.attrs.len() + 2);

                for attr_or_spread in std::mem::take(&mut el.attrs) {
                    match attr_or_spread {
                        JSXAttrOrSpread::JSXAttr(attr) => {
                            let prop_name = match &attr.name {
                                JSXAttrName::Ident(name) => Some(name.sym.to_string()),
                                _ => None,
                            };

                            if let Some(prop_name) = prop_name {
                                if is_roblox_style_prop(&prop_name) {
                                    extracted_style_props
                                        .push((prop_name, jsx_attr_value_to_expr(attr.value)));
                                    continue;
                                }
                            }

                            next_attrs.push(JSXAttrOrSpread::JSXAttr(attr));
                        }
                        other => next_attrs.push(other),
                    }
                }

                next_attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                    span: DUMMY_SP,
                    name: JSXAttrName::Ident(IdentName::new("data-rbx".into(), DUMMY_SP)),
                    value: Some(JSXAttrValue::Str(Str {
                        span: DUMMY_SP,
                        value: original_tag.into(),
                        raw: None,
                    })),
                }));

                if !extracted_style_props.is_empty() {
                    let object_props = extracted_style_props
                        .into_iter()
                        .map(|(name, value)| {
                            PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                                key: PropName::Ident(IdentName::new(name.into(), DUMMY_SP)),
                                value: Box::new(value),
                            })))
                        })
                        .collect();

                    let style_expr = Expr::Call(CallExpr {
                        span: DUMMY_SP,
                        ctxt: Default::default(),
                        callee: Callee::Expr(Box::new(Expr::Ident(Ident::new_no_ctxt(
                            RBX_STYLE_HELPER_NAME.into(),
                            DUMMY_SP,
                        )))),
                        args: vec![ExprOrSpread {
                            spread: None,
                            expr: Box::new(Expr::Object(ObjectLit {
                                span: DUMMY_SP,
                                props: object_props,
                            })),
                        }],
                        type_args: None,
                    });

                    next_attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                        span: DUMMY_SP,
                        name: JSXAttrName::Ident(IdentName::new("style".into(), DUMMY_SP)),
                        value: Some(JSXAttrValue::JSXExprContainer(JSXExprContainer {
                            span: DUMMY_SP,
                            expr: JSXExpr::Expr(Box::new(style_expr)),
                        })),
                    }));
                }

                el.attrs = next_attrs;
            }
        }
    }

    fn visit_mut_jsx_closing_element(&mut self, el: &mut JSXClosingElement) {
        el.visit_mut_children_with(self);

        if let JSXElementName::Ident(ident) = &mut el.name {
            if let Some(mapped_tag) = map_roblox_host_tag(ident.sym.as_ref()) {
                ident.sym = mapped_tag.into();
            }
        }
    }
}

#[napi(js_name = "compile_tsx")]
pub fn compile_tsx(code: String) -> napi::Result<String> {
    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(FileName::Custom("input.tsx".into()).into(), code);

    let mut recovered_errors = Vec::new();
    let mut module = parse_file_as_module(
        &fm,
        Syntax::Typescript(TsSyntax {
            decorators: true,
            tsx: true,
            ..Default::default()
        }),
        Default::default(),
        None,
        &mut recovered_errors,
    )
    .map_err(|err| napi::Error::from_reason(format!("Failed to parse TSX: {err:?}")))?;

    if !recovered_errors.is_empty() {
        return Err(napi::Error::from_reason(format!(
            "Recovered parse errors in TSX input: {recovered_errors:?}"
        )));
    }

    let mut transformer = LatticeUITransformer;
    module.visit_mut_with(&mut transformer);

    let mut out = Vec::new();
    {
        let mut emitter = Emitter {
            cfg: CodegenConfig::default(),
            cm: cm.clone(),
            comments: None,
            wr: JsWriter::new(cm.clone(), "\n", &mut out, None),
        };

        emitter
            .emit_module(&module)
            .map_err(|err| napi::Error::from_reason(format!("Failed to emit JS/TSX: {err:?}")))?;
    }

    String::from_utf8(out).map_err(|err| {
        napi::Error::from_reason(format!("Generated output was not valid UTF-8: {err}"))
    })
}
