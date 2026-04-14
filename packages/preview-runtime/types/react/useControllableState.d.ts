type UseControllableStateProps<T> = {
	value?: T;
	defaultValue: T;
	onChange?: (next: T) => void;
};
export declare function useControllableState<T>({
	value,
	defaultValue,
	onChange,
}: UseControllableStateProps<T>): readonly [
	T,
	(nextValue: T | ((previous: T) => T)) => void,
];
