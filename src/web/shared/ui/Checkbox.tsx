import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

type CheckboxProps = {
	label: string;
	checked: boolean;
	onChange(checked: boolean): void;
};

export function Checkbox(props: CheckboxProps) {
	return (
		<div className="flex min-w-0 items-center gap-2 text-sm font-normal text-neutral-950">
			<CheckboxPrimitive.Root
				aria-label={props.label}
				className="flex size-4 shrink-0 items-center justify-center rounded-none border border-neutral-950 bg-white p-0 text-white outline-none data-[checked]:bg-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
				checked={props.checked}
				onCheckedChange={(checked) => props.onChange(checked)}
			>
				<CheckboxPrimitive.Indicator
					aria-hidden="true"
					className="flex text-[11px] leading-none data-[unchecked]:hidden"
				>
					✓
				</CheckboxPrimitive.Indicator>
			</CheckboxPrimitive.Root>
			<span className="min-w-0 truncate">{props.label}</span>
		</div>
	);
}
