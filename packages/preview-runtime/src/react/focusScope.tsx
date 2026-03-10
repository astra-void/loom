import * as React from "react";
import { Slot } from "./slot";

type FocusScopeProps = {
  active?: boolean;
  asChild?: boolean;
  trapped?: boolean;
  restoreFocus?: boolean;
  children?: React.ReactNode;
};

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0,
  );
}

export function FocusScope(props: FocusScopeProps) {
  const active = props.active ?? true;
  const trapped = props.trapped === true;
  const restoreFocus = props.restoreFocus !== false;
  const rootRef = React.useRef<HTMLElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  const setRootRef = React.useCallback((element: HTMLElement | null) => {
    rootRef.current = element;
  }, []);

  React.useEffect(() => {
    if (!active) {
      return;
    }

    previousFocusRef.current =
      restoreFocus && document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const root = rootRef.current;
    if (!root) {
      return;
    }

    const focusables = getFocusableElements(root);
    if (trapped && focusables.length > 0) {
      focusables[0]?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!trapped || event.key !== "Tab") {
        return;
      }

      const currentRoot = rootRef.current;
      if (!currentRoot) {
        return;
      }

      const items = getFocusableElements(currentRoot);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const currentIndex = activeElement ? items.indexOf(activeElement) : -1;
      const lastIndex = items.length - 1;

      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault();
          items[lastIndex]?.focus();
        }
        return;
      }

      if (currentIndex === lastIndex) {
        event.preventDefault();
        items[0]?.focus();
      }
    };

    root.addEventListener("keydown", handleKeyDown);

    return () => {
      root.removeEventListener("keydown", handleKeyDown);
      if (restoreFocus) {
        previousFocusRef.current?.focus();
      }
    };
  }, [active, restoreFocus, trapped]);

  if (props.asChild) {
    const child = props.children;
    if (!React.isValidElement(child)) {
      throw new Error("[FocusScope] `asChild` requires a child element.");
    }

    return <Slot ref={setRootRef}>{child}</Slot>;
  }

  return (
    <div data-preview-focus-scope="" ref={setRootRef}>
      {props.children}
    </div>
  );
}
