import { Switch } from "@base-ui/react/switch";

type SwitchFieldProps = {
	label: string;
	checked: boolean;
	onChange(checked: boolean): void;
};

export function SwitchField(props: SwitchFieldProps) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-2 text-sm font-normal text-neutral-950">
			<span className="min-w-0">{props.label}</span>
			<Switch.Root
				aria-label={props.label}
				checked={props.checked}
				className="flex h-5 w-9 shrink-0 border border-neutral-950 bg-white p-0.5 transition-colors duration-150 ease-[ease] data-[checked]:bg-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
				onCheckedChange={(checked) => props.onChange(checked)}
			>
				<Switch.Thumb className="size-3.5 bg-neutral-950 transition-[translate,background-color] duration-150 ease-[ease] data-[checked]:translate-x-4 data-[checked]:bg-white" />
			</Switch.Root>
		</div>
	);
}
