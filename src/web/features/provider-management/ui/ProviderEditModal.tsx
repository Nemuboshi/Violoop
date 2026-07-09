import { Dialog } from "@base-ui/react/dialog";
import {
	Button,
	buttonClassName,
	dialogBackdropClassName,
	dialogDescriptionClassName,
	dialogPopupClassName,
	dialogTitleClassName,
	ResultPopover,
	type ResultPopoverResult,
	ScrollArea,
	SelectField,
	SwitchField,
	TextField,
} from "../../../shared/ui";
import {
	type ProviderEditorDraft,
	slugifyProviderName,
	thinkingFormatOptions,
} from "../model/providerDraft";

type ProviderEditModalProps = {
	draft: ProviderEditorDraft | null;
	error: string;
	open: boolean;
	saving: boolean;
	testOpen: boolean;
	testResult: ResultPopoverResult | null;
	testing: boolean;
	onChange(draft: ProviderEditorDraft | null): void;
	onOpenChange(open: boolean): void;
	onSave(draft: ProviderEditorDraft): void;
	onTest(draft: ProviderEditorDraft): void;
	onTestOpenChange(open: boolean): void;
};

export function ProviderEditModal(props: ProviderEditModalProps) {
	const draft = props.draft;
	if (!draft) {
		return null;
	}

	const update = (patch: Partial<ProviderEditorDraft>) =>
		props.onChange({ ...draft, ...patch });

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
								{draft.originalId ? "Edit provider" : "New provider"}
							</Dialog.Title>
							<Dialog.Description className={dialogDescriptionClassName}>
								Configure a global model provider.
							</Dialog.Description>
						</div>
						<Dialog.Close className={`${buttonClassName} shrink-0`}>
							Close
						</Dialog.Close>
					</div>

					<ScrollArea className="min-h-0" contentClassName="grid gap-5 p-5">
						<div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
							<TextField
								label="Provider name"
								value={draft.name}
								onChange={(value) =>
									update({
										name: value,
										id: draft.originalId ?? slugifyProviderName(value),
									})
								}
							/>
							<TextField
								label="Base URL"
								value={draft.baseUrl}
								onChange={(value) => update({ baseUrl: value })}
							/>
							<TextField
								label="API key"
								type="password"
								value={draft.apiKey}
								onChange={(value) => update({ apiKey: value })}
							/>
							<TextField
								label="Models, comma separated"
								value={draft.models}
								onChange={(value) => update({ models: value })}
							/>
						</div>

						<div className="grid grid-cols-2 gap-3 text-sm text-ink max-md:grid-cols-1">
							<SwitchField
								label="Send Authorization header"
								checked={draft.authHeader}
								onChange={(checked) => update({ authHeader: checked })}
							/>
							<SwitchField
								label="Use developer role for prompt"
								checked={draft.supportsDeveloperRole}
								onChange={(checked) =>
									update({ supportsDeveloperRole: checked })
								}
							/>
							<SwitchField
								label="Request streaming usage"
								checked={draft.supportsUsageInStreaming}
								onChange={(checked) =>
									update({ supportsUsageInStreaming: checked })
								}
							/>
							<SwitchField
								label="Supports reasoning effort"
								checked={draft.supportsReasoningEffort}
								onChange={(checked) =>
									update({ supportsReasoningEffort: checked })
								}
							/>
						</div>

						<div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
							<SelectField
								label="Thinking format"
								value={draft.thinkingFormat}
								options={thinkingFormatOptions}
								onChange={(value) =>
									update({
										thinkingFormat:
											value as ProviderEditorDraft["thinkingFormat"],
									})
								}
							/>
							<SelectField
								label="Cache control format"
								value={draft.cacheControlFormat}
								options={[
									{ label: "None", value: "" },
									{
										label: "Anthropic-style cache_control",
										value: "anthropic",
									},
								]}
								onChange={(value) =>
									update({
										cacheControlFormat:
											value === "anthropic" ? "anthropic" : "",
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
						<ResultPopover
							disabled={props.testing || props.saving}
							open={props.testOpen}
							result={props.testResult}
							triggerLabel={props.testing ? "Testing" : "Test"}
							onOpenChange={props.onTestOpenChange}
							onTrigger={() => props.onTest(draft)}
						/>
						<Button
							disabled={props.saving}
							type="button"
							variant="primary"
							onClick={() => props.onSave(draft)}
						>
							{props.saving ? "Saving" : "Save provider"}
						</Button>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
