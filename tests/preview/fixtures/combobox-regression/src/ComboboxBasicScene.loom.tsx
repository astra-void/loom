import React from "react";
import { createPortal } from "react-dom";

type ComboboxTraceGlobal = typeof globalThis & {
	__loomComboboxTrace?: string[];
	__loomComboboxRefCycles?: number;
};

function getTrace() {
	const globalRecord = globalThis as ComboboxTraceGlobal;
	if (!globalRecord.__loomComboboxTrace) {
		globalRecord.__loomComboboxTrace = [];
	}

	return globalRecord.__loomComboboxTrace;
}

function log(step: string) {
	getTrace().push(step);
}

function _incrementRefCycleCount() {
	const globalRecord = globalThis as ComboboxTraceGlobal;
	globalRecord.__loomComboboxRefCycles =
		(globalRecord.__loomComboboxRefCycles ?? 0) + 1;
	return globalRecord.__loomComboboxRefCycles;
}

type SlotProps = {
	children?: React.ReactElement | null;
} & Record<string, unknown>;

function Slot(props: SlotProps) {
	const child = React.Children.only(props.children);
	if (!React.isValidElement(child)) {
		return null;
	}

	const { children, ...rest } = props;
	return React.cloneElement(
		child,
		rest as Record<string, unknown>,
		child.props.children,
	);
}

function useLoggedState<T>(label: string, initialValue: T) {
	const [state, rawSetState] = React.useState(initialValue);
	const stateRef = React.useRef(state);
	stateRef.current = state;

	const setState = React.useCallback((nextValue: React.SetStateAction<T>) => {
		const resolved =
			typeof nextValue === "function"
				? (nextValue as (previous: T) => T)(stateRef.current)
				: nextValue;
		log(`${label}:${String(resolved)}`);
		rawSetState(nextValue);
	}, []);

	return [state, setState] as const;
}

const PortalContainerContext = React.createContext<HTMLElement | null>(null);

function PreviewRenderShell(props: { children: React.ReactNode }) {
	const [portalContainer, setPortalContainer] =
		React.useState<HTMLElement | null>(null);

	const handleRootRef = React.useCallback((node: HTMLElement | null) => {
		log(`render-shell:root-ref:${node ? "set" : "clear"}`);
		setPortalContainer(node);
	}, []);

	React.useEffect(() => {
		log(`render-shell:portal:${portalContainer ? "ready" : "waiting"}`);
	}, [portalContainer]);

	return (
		<screengui ref={handleRootRef}>
			{portalContainer ? (
				<PortalContainerContext.Provider value={portalContainer}>
					{props.children}
				</PortalContainerContext.Provider>
			) : null}
		</screengui>
	);
}

function ComboboxPreviewTargetShell(props: { children: React.ReactNode }) {
	const [portalContainer, setPortalContainer] =
		React.useState<HTMLElement | null>(null);

	const handleRootRef = React.useCallback((node: HTMLElement | null) => {
		log(`target-shell:root-ref:${node ? "set" : "clear"}`);
		if (node) {
			setPortalContainer(node);
		} else {
			setPortalContainer(null);
		}
	}, []);

	React.useEffect(() => {
		log(`target-shell:portal:${portalContainer ? "ready" : "waiting"}`);
	}, [portalContainer]);

	return (
		<screengui ref={handleRootRef}>
			{portalContainer ? (
				<PortalContainerContext.Provider value={portalContainer}>
					{props.children}
				</PortalContainerContext.Provider>
			) : null}
		</screengui>
	);
}

type ComboboxContextValue = {
	inputValue: string;
	open: boolean;
	setOpen: React.Dispatch<React.SetStateAction<boolean>>;
	setValue: React.Dispatch<React.SetStateAction<string>>;
	setInputValue: React.Dispatch<React.SetStateAction<string>>;
	value: string;
};

const ComboboxContext = React.createContext<ComboboxContextValue | null>(null);

function useComboboxContext() {
	const context = React.useContext(ComboboxContext);
	if (!context) {
		throw new Error("Combobox context is missing.");
	}

	return context;
}

function ComboboxRoot(props: { children: React.ReactNode }) {
	const [value, setValue] = useLoggedState("set:value", "alpha");
	const [open, setOpen] = useLoggedState("set:open", false);
	const [inputValue, setInputValue] = useLoggedState("set:input", "");

	React.useLayoutEffect(() => {
		if (open) {
			if (inputValue !== "") {
				log(`effect:open-clear:${inputValue}`);
				setInputValue("");
			}
			return;
		}

		if (inputValue !== value) {
			log(`effect:closed-sync:${inputValue}->${value}`);
			setInputValue(value);
		}
	}, [inputValue, open, setInputValue, value]);

	const contextValue = React.useMemo(
		() => ({
			inputValue,
			open,
			setInputValue,
			setOpen,
			setValue,
			value,
		}),
		[inputValue, open, setInputValue, setOpen, setValue, value],
	);

	return (
		<ComboboxContext.Provider value={contextValue}>
			{props.children}
		</ComboboxContext.Provider>
	);
}

function ComboboxTrigger() {
	const { open, setOpen, value } = useComboboxContext();

	return (
		<Slot
			Active={true}
			Event={{
				Activated: () => {
					log(`trigger:activated:${open ? "open" : "closed"}`);
					setOpen((nextOpen) => !nextOpen);
				},
			}}
			Text="Combobox"
		>
			<textbutton BackgroundTransparency={1} Size={UDim2.fromOffset(320, 40)}>
				<textlabel
					BackgroundTransparency={1}
					Position={UDim2.fromOffset(12, 0)}
					Size={UDim2.fromOffset(84, 40)}
					Text="Selected"
				/>
				<Slot Text={value}>
					<textlabel
						BackgroundTransparency={1}
						Position={UDim2.fromOffset(88, 0)}
						Size={UDim2.fromOffset(212, 40)}
						Text={value}
					/>
				</Slot>
			</textbutton>
		</Slot>
	);
}

function ComboboxValue(props: { placeholder: string }) {
	const { value } = useComboboxContext();
	const resolvedText = value.length > 0 ? value : props.placeholder;

	return (
		<Slot Text={resolvedText}>
			<textlabel
				BackgroundTransparency={1}
				Size={UDim2.fromOffset(320, 32)}
				Text={resolvedText}
			/>
		</Slot>
	);
}

function ComboboxInput() {
	const { inputValue, setOpen } = useComboboxContext();

	const handleTextChanged = React.useCallback(
		(textBox: HTMLInputElement) => {
			log(`input:change:${textBox.value}`);
			setOpen(true);
		},
		[setOpen],
	);

	return (
		<Slot
			Change={{ Text: handleTextChanged }}
			PlaceholderText="Type alpha, beta, gamma..."
			Text={inputValue}
			TextEditable={true}
		>
			<textbox BackgroundTransparency={1} Size={UDim2.fromOffset(320, 34)} />
		</Slot>
	);
}

function ComboboxContent() {
	const { setOpen } = useComboboxContext();

	React.useLayoutEffect(() => {
		log("content:mount");
		setOpen(false);
		return () => {
			log("content:unmount");
			setOpen(true);
		};
	}, [setOpen]);

	return (
		<frame BackgroundTransparency={1} Size={UDim2.fromOffset(320, 128)}>
			<textlabel
				BackgroundTransparency={1}
				Size={UDim2.fromOffset(320, 24)}
				Text="Combobox content"
			/>
		</frame>
	);
}

function ComboboxPortal() {
	const container = React.useContext(PortalContainerContext);
	const { open } = useComboboxContext();
	return open && container
		? createPortal(<ComboboxContent />, container)
		: null;
}

function ComboboxBasicScene() {
	return (
		<frame BackgroundTransparency={1} Size={UDim2.fromOffset(940, 560)}>
			<textlabel
				BackgroundTransparency={1}
				Text="Combobox: type-to-filter + enforced selection"
			/>
			<ComboboxRoot>
				<ComboboxTrigger />
				<ComboboxValue placeholder="Select option" />
				<ComboboxInput />
				<ComboboxPortal />
			</ComboboxRoot>
		</frame>
	);
}

export const preview = {
	render: () => (
		<PreviewRenderShell>
			<ComboboxPreviewTargetShell>
				<ComboboxBasicScene />
			</ComboboxPreviewTargetShell>
		</PreviewRenderShell>
	),
	title: "Combobox Basic",
} as const;
