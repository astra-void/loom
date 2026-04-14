use crate::model::{ComputedRect, PreviewLayoutFlexItem, PreviewLayoutNode};
use crate::resolve::{
    resolve_axis, resolve_node_dimensions, resolve_node_dimensions_with_overrides,
    resolve_padding_inset,
};

#[derive(Debug, Clone)]
pub(crate) struct ChildPlacement {
    pub(crate) node_id: String,
    pub(crate) rect: ComputedRect,
}

#[derive(Debug, Clone)]
struct ListLayoutItem {
    child_node: PreviewLayoutNode,
    cross: f32,
    flex_item: Option<PreviewLayoutFlexItem>,
    main: f32,
}

fn align_start(alignment: &str, available_space: f32) -> f32 {
    match alignment {
        "center" => available_space / 2.0,
        "bottom" | "right" => available_space,
        _ => 0.0,
    }
}

fn advance_main_cursor(cursor: &mut f32, item_main: f32, gap: f32) {
    *cursor += item_main + gap;
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

fn apply_anchor_point(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    anchor_x: f32,
    anchor_y: f32,
) -> ComputedRect {
    ComputedRect {
        x: x - anchor_x * width,
        y: y - anchor_y * height,
        width,
        height,
    }
}

pub(crate) fn compute_grid_layout(
    parent_node: &PreviewLayoutNode,
    content_rect: ComputedRect,
    child_nodes: Vec<PreviewLayoutNode>,
) -> Vec<ChildPlacement> {
    let Some(grid) = parent_node
        .layout_modifiers
        .as_ref()
        .and_then(|modifiers| modifiers.grid.as_ref())
    else {
        return Vec::new();
    };

    if child_nodes.is_empty() {
        return Vec::new();
    }

    let cell_width = resolve_axis(grid.cell_size.x, content_rect.width);
    let cell_height = resolve_axis(grid.cell_size.y, content_rect.height);
    let gap_x = resolve_axis(grid.cell_padding.x, content_rect.width);
    let gap_y = resolve_axis(grid.cell_padding.y, content_rect.height);

    let columns = if grid.fill_direction == "horizontal" {
        if grid.fill_direction_max_cells > 0 {
            grid.fill_direction_max_cells as usize
        } else {
            positive_floor_to_usize((content_rect.width + gap_x) / (cell_width + gap_x).max(1.0))
        }
    } else {
        let max_rows = if grid.fill_direction_max_cells > 0 {
            grid.fill_direction_max_cells as usize
        } else {
            positive_floor_to_usize((content_rect.height + gap_y) / (cell_height + gap_y).max(1.0))
        };
        positive_ceil_to_usize(child_nodes.len() as f32 / max_rows as f32)
    };

    let rows = if grid.fill_direction == "horizontal" {
        positive_ceil_to_usize(child_nodes.len() as f32 / columns as f32)
    } else if grid.fill_direction_max_cells > 0 {
        grid.fill_direction_max_cells as usize
    } else {
        positive_floor_to_usize((content_rect.height + gap_y) / (cell_height + gap_y).max(1.0))
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
    let invert_columns = grid.start_corner == "top-right" || grid.start_corner == "bottom-right";
    let invert_rows = grid.start_corner == "bottom-left" || grid.start_corner == "bottom-right";

    child_nodes
        .iter()
        .enumerate()
        .map(|(index, child_node)| {
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
            let row = if invert_rows {
                rows - raw_row - 1
            } else {
                raw_row
            };
            let cell_x = start_x + column as f32 * (cell_width + gap_x);
            let cell_y = start_y + row as f32 * (cell_height + gap_y);
            let (width, height) = resolve_node_dimensions_with_overrides(
                child_node,
                &ComputedRect {
                    x: cell_x,
                    y: cell_y,
                    width: cell_width,
                    height: cell_height,
                },
                Some(cell_width),
                Some(cell_height),
                None,
            );

            ChildPlacement {
                node_id: child_node.id.clone(),
                rect: apply_anchor_point(
                    cell_x + ((cell_width - width).max(0.0) / 2.0),
                    cell_y + ((cell_height - height).max(0.0) / 2.0),
                    width,
                    height,
                    child_node.layout.anchor_point.x,
                    child_node.layout.anchor_point.y,
                ),
            }
        })
        .collect()
}

pub(crate) fn compute_list_layout(
    parent_node: &PreviewLayoutNode,
    content_rect: ComputedRect,
    child_nodes: Vec<PreviewLayoutNode>,
) -> Vec<ChildPlacement> {
    let Some(list) = parent_node
        .layout_modifiers
        .as_ref()
        .and_then(|modifiers| modifiers.list.as_ref())
    else {
        return Vec::new();
    };

    if child_nodes.is_empty() {
        return Vec::new();
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
            let (width, height) = if cross_axis_flex == Some("fill") {
                if horizontal {
                    resolve_node_dimensions_with_overrides(
                        &child_node,
                        &content_rect,
                        None,
                        Some(cross_axis_size),
                        Some(true),
                    )
                } else {
                    resolve_node_dimensions_with_overrides(
                        &child_node,
                        &content_rect,
                        Some(cross_axis_size),
                        None,
                        Some(false),
                    )
                }
            } else {
                resolve_node_dimensions(&child_node, &content_rect)
            };
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
            let line_main = line.iter().map(|item| item.main).sum::<f32>()
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
        align_start(
            cross_axis_alignment,
            (cross_axis_size - total_cross).max(0.0),
        )
    } else {
        0.0
    };

    let mut placements = Vec::new();

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
        let line_main_origin = if horizontal {
            content_rect.x
        } else {
            content_rect.y
        };
        let mut main_offset =
            align_start(main_axis_alignment, (main_axis_size - used_main).max(0.0));

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

            let width = if horizontal {
                item.main
            } else {
                resolved_cross
            };
            let height = if horizontal {
                resolved_cross
            } else {
                item.main
            };
            let main_position = line_main_origin + main_offset;
            let x = if horizontal {
                main_position
            } else {
                cross_cursor + cross_offset
            };
            let y = if horizontal {
                cross_cursor + cross_offset
            } else {
                main_position
            };

            placements.push(ChildPlacement {
                node_id: item.child_node.id.clone(),
                rect: apply_anchor_point(
                    x,
                    y,
                    width,
                    height,
                    item.child_node.layout.anchor_point.x,
                    item.child_node.layout.anchor_point.y,
                ),
            });

            advance_main_cursor(&mut main_offset, item.main, gap);
        }

        cross_cursor += line_cross + gap;
    }

    placements
}
