import * as React from "react";
import { error } from "../runtime/helpers";

export function createStrictContext<T>(name: string) {
  const Context = React.createContext<T | undefined>(undefined);

  function useContextValue() {
    const value = React.useContext(Context);
    if (value === undefined) {
      error(`[${name}] context is undefined. Wrap components with <${name}.Provider>.`);
    }

    return value;
  }

  return [Context.Provider, useContextValue] as const;
}
