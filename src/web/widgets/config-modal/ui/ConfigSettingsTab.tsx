import { Dialog } from "@base-ui/react/dialog";
import { Form } from "@base-ui/react/form";
import {
	Button,
	buttonClassName,
	ScrollArea,
	SelectField,
	SwitchField,
	TextAreaField,
	TextField,
} from "../../../shared/ui";
import type {
	ConfigSelectOption,
	ConfigSettingsFormDraft,
} from "../model/types";

export function ConfigSettingsTab(props: {
	activeModelLabel: string;
	draft: ConfigSettingsFormDraft | null;
	error: string;
	modelOptions: ConfigSelectOption[];
	thinkingLevelOptions: ConfigSelectOption[];
	saving: boolean;
	onSubmit(): void;
	onUpdate(draft: ConfigSettingsFormDraft): void;
}) {
	if (!props.draft) {
		return null;
	}

	const draft = props.draft;

	return (
		<Form
			className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]"
			onFormSubmit={() => props.onSubmit()}
		>
			<ScrollArea className="min-h-0" contentClassName="grid gap-5 p-4">
				<div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
					{props.modelOptions.length > 0 ? (
						<SelectField
							label={props.activeModelLabel}
							value={draft.defaultModel}
							options={props.modelOptions}
							onChange={(value) =>
								props.onUpdate({ ...draft, defaultModel: value })
							}
						/>
					) : (
						<TextField
							label="Active model"
							value={draft.defaultModel}
							onChange={(value) =>
								props.onUpdate({ ...draft, defaultModel: value })
							}
						/>
					)}
					<TextField
						label="Temperature"
						type="number"
						value={draft.temperature}
						onChange={(value) =>
							props.onUpdate({ ...draft, temperature: value })
						}
					/>
					<SelectField
						label="Reasoning level"
						value={draft.thinkingLevel}
						options={props.thinkingLevelOptions}
						onChange={(value) =>
							props.onUpdate({
								...draft,
								thinkingLevel: value,
							})
						}
					/>
				</div>

				<TextAreaField
					controlClassName="min-h-32"
					label="System prompt"
					value={draft.systemPrompt}
					onChange={(value) =>
						props.onUpdate({ ...draft, systemPrompt: value })
					}
				/>

				<div className="grid grid-cols-2 gap-3 text-sm text-ink max-md:grid-cols-1">
					<SwitchField
						label="Mark system prompt as stable"
						checked={draft.systemPromptCache}
						onChange={(checked) =>
							props.onUpdate({ ...draft, systemPromptCache: checked })
						}
					/>
					<SwitchField
						label="Auto compact long chats"
						checked={draft.compactionEnabled}
						onChange={(checked) =>
							props.onUpdate({ ...draft, compactionEnabled: checked })
						}
					/>
				</div>

				<div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
					<TextField
						label="Compact trigger tokens"
						type="number"
						value={draft.compactionTriggerTokens}
						onChange={(value) =>
							props.onUpdate({
								...draft,
								compactionTriggerTokens: value,
							})
						}
					/>
					<TextField
						label="Keep recent tokens"
						type="number"
						value={draft.compactionKeepRecentTokens}
						onChange={(value) =>
							props.onUpdate({
								...draft,
								compactionKeepRecentTokens: value,
							})
						}
					/>
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
					{props.saving ? "Saving" : "Save"}
				</Button>
			</div>
		</Form>
	);
}
