import { Dialog } from "@base-ui/react/dialog";
import type { ConversationSummary } from "../../../entities/conversation";
import {
	Button,
	dialogBackdropClassName,
	dialogDescriptionClassName,
	dialogPopupClassName,
	dialogTitleClassName,
} from "../../../shared/ui";

type DeleteConversationModalProps = {
	conversation: ConversationSummary | null;
	deleting: boolean;
	onCancel(): void;
	onConfirm(): void;
};

export function DeleteConversationModal(props: DeleteConversationModalProps) {
	return (
		<Dialog.Root
			open={props.conversation !== null}
			onOpenChange={(open) => !open && props.onCancel()}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className={`${dialogBackdropClassName} z-[70]`} />
				<Dialog.Popup
					className={`${dialogPopupClassName} z-[75] flex w-[min(440px,calc(100vw-3rem))] flex-col gap-4 p-4`}
				>
					<div className="flex flex-col gap-1">
						<Dialog.Title className={dialogTitleClassName}>
							Delete conversation
						</Dialog.Title>
						<Dialog.Description className={dialogDescriptionClassName}>
							Delete "{props.conversation?.title ?? "this conversation"}" from
							the session list?
						</Dialog.Description>
					</div>
					<div className="flex justify-end gap-3">
						<Button type="button" onClick={props.onCancel}>
							Cancel
						</Button>
						<Button
							disabled={props.deleting}
							type="button"
							variant="danger"
							onClick={props.onConfirm}
						>
							{props.deleting ? "Deleting" : "Delete"}
						</Button>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
