import * as React from "react";
import { resolvePreviewDomProps } from "../hosts/resolveProps";
import type { PreviewDomProps, PreviewEventTable } from "../hosts/types";

type SlotProps = PreviewDomProps & {
  children: React.ReactElement;
};

function mergeEventTables(slotEvent?: PreviewEventTable, childEvent?: PreviewEventTable) {
  if (!slotEvent) {
    return childEvent;
  }

  if (!childEvent) {
    return slotEvent;
  }

  return {
    Activated:
      childEvent.Activated && slotEvent.Activated
        ? (event: Event) => {
            childEvent.Activated?.(event);
            slotEvent.Activated?.(event);
          }
        : (childEvent.Activated ?? slotEvent.Activated),
    FocusLost:
      childEvent.FocusLost && slotEvent.FocusLost
        ? (event: Event) => {
            childEvent.FocusLost?.(event);
            slotEvent.FocusLost?.(event);
          }
        : (childEvent.FocusLost ?? slotEvent.FocusLost),
  } satisfies PreviewEventTable;
}

export const Slot = React.forwardRef<HTMLElement, SlotProps>((props, forwardedRef) => {
  const child = props.children as React.ReactElement<PreviewDomProps & Record<string, unknown>>;
  const childProps = (child.props ?? {}) as PreviewDomProps;
  const slotEvent = props.Event as PreviewEventTable | undefined;
  const childEvent = childProps.Event as PreviewEventTable | undefined;
  const slotNodeId = React.useId();

  const mergedProps: PreviewDomProps = {
    ...props,
    ...childProps,
  };

  mergedProps.children = childProps.children;
  mergedProps.Event = mergeEventTables(slotEvent, childEvent);

  const normalized = resolvePreviewDomProps(mergedProps, {
    applyComputedLayout: false,
    computed: null,
    host: child.type === "button" ? "textbutton" : "frame",
    nodeId: `slot:${slotNodeId}`,
  });

  return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
    ...normalized.domProps,
    ref: forwardedRef as React.Ref<unknown>,
    children: (
      <>
        {normalized.text ? <span className="preview-host-text">{normalized.text}</span> : undefined}
        {normalized.children}
      </>
    ),
  });
});
Slot.displayName = "PreviewSlot";
