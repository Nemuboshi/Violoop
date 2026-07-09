import { Button, ScrollArea } from "../../../shared/ui";
import type { ConfigTacticListItem } from "../model/types";

export function ConfigTacticsTab(props: {
	tactics: ConfigTacticListItem[];
	onDeleteTactic(tacticId: string): void;
	onEditTactic(tacticId: string): void;
	onNewTactic(): void;
}) {
	return (
		<ScrollArea className="min-h-0" contentClassName="grid gap-4 p-4">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h3 className="text-base font-semibold text-ink">Tactics library</h3>
					<p className="mt-1 text-sm text-muted">
						Create reusable response tactics. Choose allowed tactics when
						starting a new chat.
					</p>
				</div>
				<Button
					className="shrink-0"
					type="button"
					variant="primary"
					onClick={props.onNewTactic}
				>
					New tactic
				</Button>
			</div>

			<div className="grid gap-2">
				{props.tactics.length === 0 ? (
					<div className="grid min-h-32 place-items-center border border-dashed border-neutral-950 text-sm text-neutral-600">
						No tactics yet.
					</div>
				) : (
					props.tactics.map((tactic) => (
						<div
							className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-neutral-950 bg-white px-3 py-2"
							key={tactic.id}
						>
							<div className="min-w-0">
								<strong className="block truncate text-sm text-ink">
									{tactic.name}
								</strong>
								<small className="block truncate text-muted">
									{tactic.keywordsLabel}
								</small>
							</div>
							<div className="flex gap-2">
								<Button
									type="button"
									onClick={() => props.onEditTactic(tactic.id)}
								>
									Edit
								</Button>
								<Button
									type="button"
									variant="danger"
									onClick={() => props.onDeleteTactic(tactic.id)}
								>
									Delete
								</Button>
							</div>
						</div>
					))
				)}
			</div>
		</ScrollArea>
	);
}
