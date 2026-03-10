import * as React from "react";

export type PresenceRenderState = {
  isPresent: boolean;
  onExitComplete: () => void;
};

export type PresenceRender = (state: PresenceRenderState) => React.ReactElement | undefined;

type PresenceProps = {
  children?: PresenceRender;
  render?: PresenceRender;
  present: boolean;
  exitFallbackMs?: number;
  onExitComplete?: () => void;
};

export function Presence(props: PresenceProps) {
  const [mounted, setMounted] = React.useState(props.present);
  const [isPresent, setIsPresent] = React.useState(props.present);
  const mountedRef = React.useRef(mounted);
  const timeoutRef = React.useRef<number | undefined>(undefined);
  const onExitCompleteRef = React.useRef(props.onExitComplete);

  React.useEffect(() => {
    onExitCompleteRef.current = props.onExitComplete;
  }, [props.onExitComplete]);

  React.useEffect(() => {
    mountedRef.current = mounted;
  }, [mounted]);

  const completeExit = React.useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }

    mountedRef.current = false;
    setMounted(false);
    onExitCompleteRef.current?.();
  }, []);

  React.useEffect(() => {
    if (props.present) {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }

      if (!mountedRef.current) {
        mountedRef.current = true;
        setMounted(true);
      }

      setIsPresent(true);
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    setIsPresent(false);
    timeoutRef.current = window.setTimeout(completeExit, props.exitFallbackMs ?? 0);
  }, [completeExit, props.exitFallbackMs, props.present]);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!mounted) {
    return undefined;
  }

  const render = props.render ?? props.children;
  if (!render) {
    return undefined;
  }

  return render({
    isPresent,
    onExitComplete: completeExit,
  });
}
