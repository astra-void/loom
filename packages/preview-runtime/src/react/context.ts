import * as React from "react";
import { error } from "../runtime/helpers";

export function createStrictContext<T>(name: string) {
	const Context = React.createContext<T | undefined>(undefined);

	function useContextValue(): Exclude<T, undefined> {
		const value = React.useContext(Context);
		if (value === undefined) {
			error(
				`[${name}] context is undefined. Wrap components with <${name}.Provider>.`,
			);
		}

		return value as Exclude<T, undefined>;
	}

	return [Context.Provider, useContextValue] as const;
}
