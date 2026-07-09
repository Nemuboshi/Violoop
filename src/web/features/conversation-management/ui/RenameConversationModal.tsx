import { Dialog } from "@base-ui/react/dialog";
import { Form } from "@base-ui/react/form";
import type { ConversationSummary } from "../../../entities/conversation";
import {
	Button,
	buttonClassName,
	dialogBackdropClassName,
	dialogDescriptionClassName,
	dialogPopupClassName,
	dialogTitleClassName,
	TextField,
} from "../../../shared/ui";

type RenameConversationModalProps = {
	conversation: ConversationSummary | null;
	renaming: boolean;
	title: string;
	onCancel(): void;
	onConfirm(): void;
	onTitleChange(title: string): void;
};

export function RenameConversationModal(props: RenameConversationModalProps) {
	return (
		<Dialog.Root
			open={props.conversation !== null}
			onOpenChange={props.onCancel}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className={`${dialogBackdropClassName} z-[55]`} />
				<Dialog.Popup
					className={`${dialogPopupClassName} z-[60] grid w-[min(420px,calc(100vw-3rem))] gap-4 p-4`}
				>
					<div className="flex items-start justify-between gap-4">
						<div>
							<Dialog.Title className={dialogTitleClassName}>
								Rename session
							</Dialog.Title>
							<Dialog.Description className={dialogDescriptionClassName}>
								Update the name shown in the sessions list.
							</Dialog.Description>
						</div>
						<Dialog.Close className={`${buttonClassName} shrink-0`}>
							Close
						</Dialog.Close>
					</div>

					<Form className="grid gap-4" onFormSubmit={props.onConfirm}>
						<TextField
							label="Session name"
							value={props.title}
							onChange={props.onTitleChange}
						/>
						<div className="flex justify-end gap-3">
							<Dialog.Close className={buttonClassName} type="button">
								Cancel
							</Dialog.Close>
							<Button disabled={props.renaming} type="submit" variant="primary">
								{props.renaming ? "Renaming" : "Rename"}
							</Button>
						</div>
					</Form>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
