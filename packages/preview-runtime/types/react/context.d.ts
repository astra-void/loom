import * as React from "react";
export declare function createStrictContext<T>(name: string): readonly [React.Provider<T | undefined>, () => T & ({} | null)];
