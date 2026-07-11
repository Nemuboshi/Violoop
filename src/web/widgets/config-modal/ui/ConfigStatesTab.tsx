import { useState } from "react";
import type { StateDefinition } from "../../../entities/tactic";
import { createClientId } from "../../../shared/lib";
import {
	Button,
	ScrollArea,
	TextAreaField,
	TextField,
} from "../../../shared/ui";
import type { ConfigStateListItem } from "../model/types";

type StateDraft = Omit<StateDefinition, "description"> & {
	description: string;
	originalId: string | null;
};

export function ConfigStatesTab(props: {
	error: string;
	saving: boolean;
	states: ConfigStateListItem[];
	onDeleteState(stateId: string): void;
	onSaveState(state: StateDefinition, originalId: string | null): void;
}) {
	const [draft, setDraft] = useState<StateDraft | null>(null);
	const update = (currentDraft: StateDraft, patch: Partial<StateDraft>) =>
		setDraft({ ...currentDraft, ...patch });

	return (
		<ScrollArea className="min-h-0" contentClassName="grid gap-4 p-4">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h3 className="text-base font-semibold text-ink">Session states</h3>
					<p className="mt-1 text-sm text-muted">
						Define global state bars. New chats choose which states to enable.
					</p>
				</div>
				<Button
					className="shrink-0"
					type="button"
					variant="primary"
					onClick={() =>
						setDraft({
							id: createClientId("state"),
							originalId: null,
							name: "New state",
							description: "",
							defaultValue: 50,
						})
					}
				>
					New state
				</Button>
			</div>

			{draft ? (
				<div className="grid gap-3 border border-neutral-950 bg-white p-3">
					<div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
						<TextField
							label="Name"
							value={draft.name}
							onChange={(name) => update(draft, { name })}
						/>
						<TextField
							label="Default value"
							type="number"
							value={String(draft.defaultValue)}
							onChange={(value) =>
								update(draft, { defaultValue: Number(value) })
							}
						/>
					</div>
					<TextAreaField
						controlClassName="min-h-24"
						label="Description"
						value={draft.description}
						onChange={(description) => update(draft, { description })}
					/>
					<div className="flex justify-end gap-3">
						<Button type="button" onClick={() => setDraft(null)}>
							Cancel
						</Button>
						<Button
							disabled={props.saving}
							type="button"
							variant="primary"
							onClick={() => {
								props.onSaveState(
									{
										id: draft.id,
										name: draft.name,
										description: draft.description,
										defaultValue: draft.defaultValue,
									},
									draft.originalId,
								);
							}}
						>
							{props.saving ? "Saving" : "Save state"}
						</Button>
					</div>
				</div>
			) : null}

			<div className="grid gap-2">
				{props.states.length === 0 ? (
					<div className="grid min-h-32 place-items-center border border-dashed border-neutral-950 text-sm text-neutral-600">
						No states yet.
					</div>
				) : (
					props.states.map((state) => (
						<div
							className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-neutral-950 bg-white px-3 py-2"
							key={state.id}
						>
							<div className="min-w-0">
								<strong className="block truncate text-sm text-ink">
									{state.name}
								</strong>
								<small className="block truncate text-muted">
									Default {state.defaultValue}
								</small>
								{state.description ? (
									<small className="block truncate text-muted">
										{state.description}
									</small>
								) : null}
							</div>
							<div className="flex gap-2">
								<Button
									type="button"
									onClick={() =>
										setDraft({
											...state,
											originalId: state.id,
										})
									}
								>
									Edit
								</Button>
								<Button
									type="button"
									variant="danger"
									onClick={() => props.onDeleteState(state.id)}
								>
									Delete
								</Button>
							</div>
						</div>
					))
				)}
			</div>

			{props.error ? (
				<p className="border-l-4 border-danger bg-danger-surface px-3 py-2 text-sm text-danger">
					{props.error}
				</p>
			) : null}
		</ScrollArea>
	);
}
