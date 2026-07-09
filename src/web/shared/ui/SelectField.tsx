import { Select } from "@base-ui/react/select";
import type { ComponentProps } from "react";

type SelectOption<T extends string> = {
	label: string;
	value: T;
};

type SelectFieldProps<T extends string> = {
	label: string;
	value: T;
	options: Array<SelectOption<T>>;
	onChange(value: T): void;
};

export function SelectField<T extends string>(props: SelectFieldProps<T>) {
	return (
		<Select.Root
			items={props.options}
			value={props.value}
			onValueChange={(value) => props.onChange(value as T)}
		>
			<div className="grid min-w-0 gap-2">
				<Select.Label className="cursor-default text-sm font-bold text-neutral-950">
					{props.label}
				</Select.Label>
				<Select.Trigger className="flex h-8 min-w-0 items-center justify-between gap-3 border border-neutral-950 bg-white pl-2 pr-1 text-left text-sm font-normal leading-none text-neutral-950 outline-none select-none hover:not-data-disabled:bg-neutral-100 active:not-data-disabled:bg-neutral-200 data-popup-open:bg-neutral-100 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-neutral-950">
					<Select.Value className="min-w-0 truncate data-placeholder:text-neutral-500" />
					<Select.Icon className="grid h-6 w-6 shrink-0 place-items-center text-neutral-950">
						<CaretUpDownIcon />
					</Select.Icon>
				</Select.Trigger>
			</div>
			<Select.Portal>
				<Select.Positioner
					align="start"
					alignItemWithTrigger={false}
					className="z-[60] outline-none select-none"
					sideOffset={4}
				>
					<Select.Popup className="group min-w-[var(--anchor-width)] origin-[var(--transform-origin)] border border-neutral-950 bg-white text-neutral-950 shadow-[0.25rem_0.25rem_0] shadow-black/12 outline-none transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
						<Select.List className="relative max-h-[var(--available-height)] overflow-y-auto py-1 scroll-py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
							{props.options.map((option) => (
								<Select.Item
									className="grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 py-1.5 pl-2.5 pr-4 text-sm outline-none select-none data-highlighted:bg-neutral-950 data-highlighted:text-white"
									key={option.value}
									value={option.value}
								>
									<Select.ItemIndicator
										aria-hidden="true"
										className="col-start-1"
									>
										<CheckIcon />
									</Select.ItemIndicator>
									<Select.ItemText className="col-start-2 truncate">
										{option.label}
									</Select.ItemText>
								</Select.Item>
							))}
						</Select.List>
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	);
}

function CaretUpDownIcon(props: ComponentProps<"svg">) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
			{...props}
		>
			<path
				d="M4 6L8 2L12 6"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M4 10L8 14L12 10"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function CheckIcon(props: ComponentProps<"svg">) {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 14 14"
			fill="none"
			aria-hidden="true"
			{...props}
		>
			<path
				d="M3 7L6 10L11 4"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
