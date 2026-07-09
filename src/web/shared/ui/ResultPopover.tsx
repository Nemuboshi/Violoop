import { Popover } from "@base-ui/react/popover";
import {
	buttonClassName,
	popoverArrowClassName,
	popoverPopupClassName,
} from "./styles";

export type ResultPopoverResult = {
	status: "success" | "error";
	title: string;
	detail: string;
};

type ResultPopoverProps = {
	open: boolean;
	result: ResultPopoverResult | null;
	triggerLabel: string;
	disabled?: boolean;
	onOpenChange(open: boolean): void;
	onTrigger(): void;
};

export function ResultPopover(props: ResultPopoverProps) {
	return (
		<Popover.Root
			open={props.open}
			onOpenChange={(open) => {
				props.onOpenChange(open && props.result !== null);
			}}
		>
			<Popover.Trigger
				className={buttonClassName}
				disabled={props.disabled}
				type="button"
				onClick={(event) => {
					event.preventDefault();
					props.onOpenChange(false);
					props.onTrigger();
				}}
			>
				{props.triggerLabel}
			</Popover.Trigger>
			{props.result ? (
				<Popover.Portal>
					<Popover.Positioner
						className="z-[90] outline-none"
						side="top"
						sideOffset={8}
					>
						<Popover.Popup
							className={`w-[min(320px,calc(100vw-2rem))] ${popoverPopupClassName}`}
						>
							<Popover.Arrow className={popoverArrowClassName} />
							<div className="grid gap-1">
								<Popover.Title className="text-sm font-bold text-neutral-950">
									{props.result.title}
								</Popover.Title>
								<Popover.Description
									className={
										props.result.status === "error"
											? "text-sm text-red-700"
											: "text-sm text-neutral-600"
									}
								>
									{props.result.detail}
								</Popover.Description>
							</div>
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			) : null}
		</Popover.Root>
	);
}
