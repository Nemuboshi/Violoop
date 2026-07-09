import { Dialog } from "@base-ui/react/dialog";
import { Form } from "@base-ui/react/form";
import type { StateDefinition, TacticOverview } from "../../../entities/tactic";
import {
	Button,
	buttonClassName,
	Checkbox,
	dialogBackdropClassName,
	dialogDescriptionClassName,
	dialogPopupClassName,
	dialogTitleClassName,
	ScrollArea,
	TextAreaField,
	TextField,
} from "../../../shared/ui";
import type { NewChatDraft } from "../model/useNewChatWorkflow";

type NewChatModalProps = {
	open: boolean;
	draft: NewChatDraft;
	error: string;
	saving: boolean;
	tactics: TacticOverview[];
	stateDefinitions: StateDefinition[];
	selectedTacticIds: string[];
	selectedStateIds: string[];
	onDraftChange(draft: NewChatDraft): void;
	onOpenChange(open: boolean): void;
	onStart(): void;
	onStateToggle(stateId: string, enabled: boolean): void;
	onToggle(tacticId: string, enabled: boolean): void;
};

export function NewChatModal(props: NewChatModalProps) {
	const update = (patch: Partial<NewChatDraft>) =>
		props.onDraftChange({ ...props.draft, ...patch });
	const requiredStateIds = new Set(
		props.tactics
			.filter((tactic) => props.selectedTacticIds.includes(tactic.id))
			.flatMap((tactic) => tactic.requiredStateIds),
	);

	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className={`${dialogBackdropClassName} z-40`} />
				<Dialog.Popup
					className={`${dialogPopupClassName} z-50 grid max-h-[88vh] w-[min(640px,calc(100vw-3rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden`}
				>
					<div className="flex items-start justify-between gap-4 border-b border-neutral-950 p-4">
						<div>
							<Dialog.Title className={dialogTitleClassName}>
								New chat
							</Dialog.Title>
							<Dialog.Description className={dialogDescriptionClassName}>
								Set this session's identity before the first message.
							</Dialog.Description>
						</div>
						<Dialog.Close className={`${buttonClassName} shrink-0`}>
							Close
						</Dialog.Close>
					</div>

					<Form
						className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]"
						onFormSubmit={props.onStart}
					>
						<ScrollArea className="h-full min-h-0" contentClassName="grid gap-5 p-5">
							<TextField
								label="Session name"
								value={props.draft.title}
								onChange={(title) => update({ title })}
							/>
							<TextField
								label="Violoop name"
								value={props.draft.assistantName}
								onChange={(assistantName) => update({ assistantName })}
							/>
							<TextAreaField
								controlClassName="min-h-24"
								label="Your role in this chat"
								value={props.draft.userRole}
								onChange={(userRole) => update({ userRole })}
							/>
							<TextAreaField
								controlClassName="min-h-24"
								label="Violoop role in this chat"
								value={props.draft.assistantRole}
								onChange={(assistantRole) => update({ assistantRole })}
							/>

							<div className="grid gap-3 border-t border-neutral-950 pt-4">
								<div>
									<h3 className="text-sm font-semibold text-ink">
										Allowed tactics
									</h3>
									<p className="mt-1 text-xs text-muted">
										This selection is locked after the session starts.
									</p>
								</div>
								<div className="grid gap-2">
									{props.tactics.length === 0 ? (
										<p className="border border-neutral-950 bg-white px-3 py-3 text-sm text-neutral-600">
											No tactics are available.
										</p>
									) : (
										props.tactics.map((tactic) => (
											<Checkbox
												key={tactic.id}
												label={tactic.name}
												checked={props.selectedTacticIds.includes(tactic.id)}
												onChange={(checked) =>
													props.onToggle(tactic.id, checked)
												}
											/>
										))
									)}
								</div>
							</div>

							<div className="grid gap-3 border-t border-neutral-950 pt-4">
								<div>
									<h3 className="text-sm font-semibold text-ink">
										Session states
									</h3>
									<p className="mt-1 text-xs text-muted">
										Enabled states are initialized for this session. Required
										states come from the selected tactics.
									</p>
								</div>
								<div className="grid gap-2">
									{props.stateDefinitions.length === 0 ? (
										<p className="border border-neutral-950 bg-white px-3 py-3 text-sm text-neutral-600">
											No session states are configured.
										</p>
									) : (
										props.stateDefinitions.map((state) => {
											const required = requiredStateIds.has(state.id);
											return (
												<Checkbox
													key={state.id}
													label={`${state.name}${required ? " / required" : ""}`}
													checked={props.selectedStateIds.includes(state.id)}
													onChange={(checked) =>
														props.onStateToggle(state.id, checked)
													}
												/>
											);
										})
									)}
								</div>
							</div>

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
							<Button disabled={props.saving} type="submit" variant="primary">
								{props.saving ? "Starting" : "Start chat"}
							</Button>
						</div>
					</Form>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
