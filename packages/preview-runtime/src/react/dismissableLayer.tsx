import * as React from "react";

export type LayerInteractEvent = {
  originalEvent: Event;
  defaultPrevented: boolean;
  preventDefault: () => void;
};

type DismissableLayerProps = {
  children?: React.ReactNode;
  enabled?: boolean;
  modal?: boolean;
  disableOutsidePointerEvents?: boolean;
  onPointerDownOutside?: (event: LayerInteractEvent) => void;
  onInteractOutside?: (event: LayerInteractEvent) => void;
  onEscapeKeyDown?: (event: LayerInteractEvent) => void;
  onDismiss?: () => void;
};

function createLayerInteractEvent(originalEvent: Event): LayerInteractEvent {
  const event: LayerInteractEvent = {
    originalEvent,
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
      originalEvent.preventDefault();
    },
  };

  return event;
}

export function DismissableLayer(props: DismissableLayerProps) {
  const enabled = props.enabled ?? true;
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const interactEvent = createLayerInteractEvent(event);
      props.onEscapeKeyDown?.(interactEvent);
      if (!interactEvent.defaultPrevented) {
        props.onDismiss?.();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }

      if (event.target instanceof Node && root.contains(event.target)) {
        return;
      }

      const interactEvent = createLayerInteractEvent(event);
      props.onPointerDownOutside?.(interactEvent);
      props.onInteractOutside?.(interactEvent);
      if (!interactEvent.defaultPrevented) {
        props.onDismiss?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    const previousOverflow = document.body.style.overflow;
    if (props.modal === true || props.disableOutsidePointerEvents === true) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [
    enabled,
    props.disableOutsidePointerEvents,
    props.modal,
    props.onDismiss,
    props.onEscapeKeyDown,
    props.onInteractOutside,
    props.onPointerDownOutside,
  ]);

  return (
    <div data-preview-dismissable-layer="" ref={rootRef}>
      {props.children}
    </div>
  );
}
