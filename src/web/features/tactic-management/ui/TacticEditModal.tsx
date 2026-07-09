import { Dialog } from "@base-ui/react/dialog";
import type { StateDefinition } from "../../../entities/tactic";
import {
	Button,
	buttonClassName,
	dialogBackdropClassName,
	dialogDescriptionClassName,
	dialogPopupClassName,
	dialogTitleClassName,
	ScrollArea,
	SelectField,
	TextAreaField,
	TextField,
} from "../../../shared/ui";
import {
	emotionOperatorOptions,
	slugifyTacticName,
	type TacticEditorDraft,
} from "../model/tacticDraft";

type TacticEditModalProps = {
	draft: TacticEditorDraft | null;
	error: string;
	open: boolean;
	saving: boolean;
	stateDefinitions: StateDefinition[];
	onChange(draft: TacticEditorDraft | null): void;
	onOpenChange(open: boolean): void;
	onSave(draft: TacticEditorDraft): void;
};

export function TacticEditModal(props: TacticEditModalProps) {
	const draft = props.draft;
	if (!draft) {
		return null;
	}

	const update = (patch: Partial<TacticEditorDraft>) =>
		props.onChange({ ...draft, ...patch });
	const updateRule = (
		index: number,
		patch: Partial<TacticEditorDraft["emotionRules"][number]>,
	) => {
		update({
			emotionRules: draft.emotionRules.map((rule, ruleIndex) =>
				ruleIndex === index ? { ...rule, ...patch } : rule,
			),
		});
	};
	const removeRule = (index: number) =>
		update({
			emotionRules: draft.emotionRules.filter(
				(_, ruleIndex) => ruleIndex !== index,
			),
		});
	const stateOptions = props.stateDefinitions.map((state) => ({
		label: state.name,
		value: state.id,
	}));
	const addRule = () => {
		const firstState = props.stateDefinitions[0];
		if (!firstState) {
			return;
		}
		update({
			emotionRules: [
				...draft.emotionRules,
				{ key: firstState.id, operator: ">=", value: "60" },
			],
		});
	};

	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className={`${dialogBackdropClassName} z-[55]`} />
				<Dialog.Popup
					className={`${dialogPopupClassName} z-[60] grid max-h-[88vh] w-[min(640px,calc(100vw-3rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden`}
				>
					<div className="flex items-start justify-between gap-4 border-b border-neutral-950 p-4">
						<div>
							<Dialog.Title className={dialogTitleClassName}>
								{draft.originalId ? "Edit tactic" : "New tactic"}
							</Dialog.Title>
							<Dialog.Description className={dialogDescriptionClassName}>
								Define when this tactic should be considered and how it should
								shape the answer.
							</Dialog.Description>
						</div>
						<Dialog.Close className={`${buttonClassName} shrink-0`}>
							Close
						</Dialog.Close>
					</div>

					<ScrollArea className="min-h-0" contentClassName="grid gap-5 p-5">
						<div className="grid gap-4">
							<TextField
								label="Name"
								value={draft.name}
								onChange={(value) =>
									update({
										name: value,
										id: draft.originalId ?? slugifyTacticName(value),
									})
								}
							/>
						</div>

						<TextField
							label="Trigger keywords, comma separated"
							value={draft.keywords}
							onChange={(value) => update({ keywords: value })}
						/>

						<div className="grid gap-3 border border-neutral-950 bg-white p-3">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-semibold text-ink">
										User state triggers
									</h3>
									<p className="mt-1 text-xs text-muted">
										Load this tactic when a session state crosses a threshold.
									</p>
								</div>
								<Button type="button" onClick={addRule}>
									Add rule
								</Button>
							</div>
							{draft.emotionRules.length === 0 ? (
								<p className="border border-dashed border-neutral-950 bg-white px-3 py-3 text-sm text-neutral-600">
									No state trigger rules.
								</p>
							) : (
								<div className="grid gap-2">
									{draft.emotionRules.map((rule, index) => (
										<div
											className="grid grid-cols-[minmax(0,1.4fr)_110px_100px_auto] items-end gap-2 max-md:grid-cols-1"
											key={`${rule.key}-${rule.operator}-${rule.value}`}
										>
											<SelectField
												label="State"
												value={rule.key}
												options={stateOptions}
												onChange={(value) => updateRule(index, { key: value })}
											/>
											<SelectField
												label="When"
												value={rule.operator}
												options={emotionOperatorOptions}
												onChange={(value) =>
													updateRule(index, { operator: value })
												}
											/>
											<TextField
												label="Value"
												type="number"
												value={rule.value}
												onChange={(value) => updateRule(index, { value })}
											/>
											<Button
												type="button"
												variant="danger"
												onClick={() => removeRule(index)}
											>
												Remove
											</Button>
										</div>
									))}
								</div>
							)}
						</div>

						<TextField
							label="Do not use when message contains"
							value={draft.blockedKeywords}
							onChange={(value) => update({ blockedKeywords: value })}
						/>
						<TextAreaField
							controlClassName="min-h-36"
							label="Instruction"
							value={draft.instruction}
							onChange={(value) => update({ instruction: value })}
						/>

						{props.error ? (
							<p className="border-l-4 border-danger bg-danger-surface px-3 py-2 text-sm text-danger">
								{props.error}
							</p>
						) : null}
					</ScrollArea>

					<div className="flex justify-end gap-3 border-t border-neutral-950 p-4">
						<Dialog.Close className={buttonClassName} type="button">
							Cancel
						</Dialog.Close>
						<Button
							disabled={props.saving}
							type="button"
							variant="primary"
							onClick={() => props.onSave(draft)}
						>
							{props.saving ? "Saving" : "Save tactic"}
						</Button>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
