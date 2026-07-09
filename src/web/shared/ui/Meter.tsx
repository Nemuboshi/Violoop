import { Meter as MeterPrimitive } from "@base-ui/react/meter";

type MeterProps = {
	label: string;
	value: number;
};

export function Meter(props: MeterProps) {
	const value = Math.max(0, Math.min(100, props.value));

	return (
		<MeterPrimitive.Root
			className="grid max-w-full grid-cols-2 gap-y-2"
			max={100}
			min={0}
			value={value}
		>
			<MeterPrimitive.Label className="text-sm font-normal text-neutral-950">
				{props.label}
			</MeterPrimitive.Label>
			<MeterPrimitive.Value className="text-right text-sm text-neutral-950" />
			<MeterPrimitive.Track className="col-span-2 h-3 overflow-hidden bg-neutral-200">
				<MeterPrimitive.Indicator
					className="h-full bg-neutral-950 transition-[width] duration-500"
					style={{ width: `${value}%` }}
				/>
			</MeterPrimitive.Track>
		</MeterPrimitive.Root>
	);
}
