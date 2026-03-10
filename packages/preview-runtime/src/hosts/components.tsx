import * as React from "react";
import { useTextScaleStyle } from "../style/textStyles";
import { domPresentationAdapter } from "./domAdapter";
import { type PreviewDomProps } from "./types";
import { useHostLayout, withNodeParent } from "./useHostLayout";

function useMergedRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return React.useCallback(
    (value: T | null) => {
      for (const ref of refs) {
        if (!ref) {
          continue;
        }

        if (typeof ref === "function") {
          ref(value);
          continue;
        }

        (ref as React.MutableRefObject<T | null>).current = value;
      }
    },
    [refs],
  );
}

function renderChildren(nodeId: string, rect: ReturnType<typeof useHostLayout>["computed"], children: React.ReactNode) {
  return withNodeParent(nodeId, rect, children);
}

function createSimpleHost(host: Parameters<typeof useHostLayout>[0], displayName: string) {
  const Component = React.forwardRef<HTMLElement, PreviewDomProps>((props, forwardedRef) => {
    const { computed, elementRef, hostNode, nodeId } = useHostLayout(host, props);
    const mergedRef = useMergedRefs(forwardedRef as React.Ref<HTMLElement>, elementRef as React.Ref<HTMLElement>);

    return domPresentationAdapter.render(
      hostNode,
      renderChildren(nodeId, computed, props.children as React.ReactNode),
      mergedRef,
    );
  });

  Component.displayName = displayName;
  return Component;
}

export const Frame = createSimpleHost("frame", "PreviewFrame");

export const TextButton = React.forwardRef<HTMLElement, PreviewDomProps>((props, forwardedRef) => {
  const { computed, elementRef, hostNode, nodeId, patchDomProps } = useHostLayout("textbutton", props);
  const innerRef = elementRef as React.RefObject<HTMLButtonElement | null>;
  const mergedRef = useMergedRefs(
    forwardedRef as React.Ref<HTMLButtonElement>,
    innerRef as React.Ref<HTMLButtonElement>,
  );
  const textScaleStyle = useTextScaleStyle({
    elementRef: innerRef,
    enabled: props.TextScaled === true,
    fontFamily: hostNode.presentationHints.domProps.style?.fontFamily as string | undefined,
    fontStyle: hostNode.presentationHints.domProps.style?.fontStyle as React.CSSProperties["fontStyle"] | undefined,
    fontWeight: hostNode.presentationHints.domProps.style?.fontWeight as React.CSSProperties["fontWeight"] | undefined,
    lineHeight: hostNode.presentationHints.domProps.style?.lineHeight,
    text: hostNode.presentationHints.text,
    wrapped: props.TextWrapped === true,
  });
  const renderNode = React.useMemo(
    () =>
      patchDomProps({
        ...hostNode.presentationHints.domProps,
        style: {
          ...(hostNode.presentationHints.domProps.style as React.CSSProperties | undefined),
          ...(textScaleStyle ?? {}),
        },
      }),
    [hostNode.presentationHints.domProps, patchDomProps, textScaleStyle],
  );

  return domPresentationAdapter.render(
    renderNode,
    renderChildren(nodeId, computed, props.children as React.ReactNode),
    mergedRef,
  );
});
TextButton.displayName = "PreviewTextButton";

export const ScreenGui = createSimpleHost("screengui", "PreviewScreenGui");

export const TextLabel = React.forwardRef<HTMLElement, PreviewDomProps>((props, forwardedRef) => {
  const { computed, elementRef, hostNode, nodeId, patchDomProps } = useHostLayout("textlabel", props);
  const innerRef = elementRef as React.RefObject<HTMLDivElement | null>;
  const mergedRef = useMergedRefs(forwardedRef as React.Ref<HTMLDivElement>, innerRef as React.Ref<HTMLDivElement>);
  const textScaleStyle = useTextScaleStyle({
    elementRef: innerRef,
    enabled: props.TextScaled === true,
    fontFamily: hostNode.presentationHints.domProps.style?.fontFamily as string | undefined,
    fontStyle: hostNode.presentationHints.domProps.style?.fontStyle as React.CSSProperties["fontStyle"] | undefined,
    fontWeight: hostNode.presentationHints.domProps.style?.fontWeight as React.CSSProperties["fontWeight"] | undefined,
    lineHeight: hostNode.presentationHints.domProps.style?.lineHeight,
    text: hostNode.presentationHints.text,
    wrapped: props.TextWrapped === true,
  });
  const renderNode = React.useMemo(
    () =>
      patchDomProps({
        ...hostNode.presentationHints.domProps,
        style: {
          ...(hostNode.presentationHints.domProps.style as React.CSSProperties | undefined),
          ...(textScaleStyle ?? {}),
        },
      }),
    [hostNode.presentationHints.domProps, patchDomProps, textScaleStyle],
  );

  return domPresentationAdapter.render(
    renderNode,
    renderChildren(nodeId, computed, props.children as React.ReactNode),
    mergedRef,
  );
});
TextLabel.displayName = "PreviewTextLabel";

export const TextBox = React.forwardRef<HTMLElement, PreviewDomProps>((props, forwardedRef) => {
  const { computed, elementRef, hostNode, nodeId, patchDomProps } = useHostLayout("textbox", props);
  const innerRef = elementRef as React.RefObject<HTMLInputElement | null>;
  const mergedRef = useMergedRefs(forwardedRef as React.Ref<HTMLInputElement>, innerRef as React.Ref<HTMLInputElement>);
  const textScaleStyle = useTextScaleStyle({
    elementRef: innerRef,
    enabled: props.TextScaled === true,
    fontFamily: hostNode.presentationHints.domProps.style?.fontFamily as string | undefined,
    fontStyle: hostNode.presentationHints.domProps.style?.fontStyle as React.CSSProperties["fontStyle"] | undefined,
    fontWeight: hostNode.presentationHints.domProps.style?.fontWeight as React.CSSProperties["fontWeight"] | undefined,
    lineHeight: hostNode.presentationHints.domProps.style?.lineHeight,
    text: hostNode.presentationHints.text,
    wrapped: props.TextWrapped === true,
  });
  const renderNode = React.useMemo(
    () =>
      patchDomProps({
        ...hostNode.presentationHints.domProps,
        style: {
          ...(hostNode.presentationHints.domProps.style as React.CSSProperties | undefined),
          ...(textScaleStyle ?? {}),
        },
      }),
    [hostNode.presentationHints.domProps, patchDomProps, textScaleStyle],
  );

  return domPresentationAdapter.render(
    renderNode,
    renderChildren(nodeId, computed, props.children as React.ReactNode),
    mergedRef,
  );
});
TextBox.displayName = "PreviewTextBox";

export const ImageLabel = React.forwardRef<HTMLElement, PreviewDomProps>((props, forwardedRef) => {
  const { computed, elementRef, hostNode, nodeId } = useHostLayout("imagelabel", props);
  const mergedRef = useMergedRefs(
    forwardedRef as React.Ref<HTMLImageElement>,
    elementRef as React.Ref<HTMLImageElement>,
  );

  return domPresentationAdapter.render(
    hostNode,
    renderChildren(nodeId, computed, props.children as React.ReactNode),
    mergedRef,
  );
});
ImageLabel.displayName = "PreviewImageLabel";

export const ScrollingFrame = createSimpleHost("scrollingframe", "PreviewScrollingFrame");
