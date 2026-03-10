import * as React from "react";

type UseControllableStateProps<T> = {
  value?: T;
  defaultValue: T;
  onChange?: (next: T) => void;
};

export function useControllableState<T>({ value, defaultValue, onChange }: UseControllableStateProps<T>) {
  const [inner, setInner] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const state = controlled ? value : inner;
  const stateRef = React.useRef(state);
  const controlledRef = React.useRef(controlled);
  const onChangeRef = React.useRef(onChange);

  stateRef.current = state;
  controlledRef.current = controlled;
  onChangeRef.current = onChange;

  const setState = React.useCallback((nextValue: T | ((previous: T) => T)) => {
    const current = stateRef.current;
    const computed = typeof nextValue === "function" ? (nextValue as (previous: T) => T)(current) : nextValue;

    if (Object.is(computed, current)) {
      return;
    }

    stateRef.current = computed;

    if (!controlledRef.current) {
      setInner(computed);
    }

    onChangeRef.current?.(computed);
  }, []);

  return [state, setState] as const;
}
