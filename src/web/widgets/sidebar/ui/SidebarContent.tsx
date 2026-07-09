import { Button, Meter, ScrollArea } from "../../../shared/ui";
import type { SidebarView } from "../model/types";

type SidebarContentProps = {
	className?: string;
	view: SidebarView;
	onConfigure(): void;
	onDeleteConversation(conversationId: string): void;
	onNewChat(): void;
	onRenameConversation(conversationId: string): void;
	onRestoreConversation(conversationId: string): void;
};

export function SidebarContent(props: SidebarContentProps) {
	return (
		<div className={`flex min-h-full flex-col gap-5 ${props.className ?? ""}`}>
			<div className="grid gap-3">
				<Button className="min-h-9" type="button" onClick={props.onNewChat}>
					New chat
				</Button>
				<Button
					className="min-h-9"
					variant="primary"
					type="button"
					onClick={props.onConfigure}
				>
					Configure
				</Button>
			</div>

			<ScrollArea
				className="max-h-64 min-w-0 border-t border-neutral-950 pt-4 max-md:max-h-none"
				viewportClassName="max-h-60 max-md:max-h-none"
			>
				<div className="grid min-w-0 gap-1">
					<span className="mb-1 text-sm font-bold text-neutral-950">
						Sessions
					</span>
					{props.view.conversations.length === 0 ? (
						<small className="border border-dashed border-neutral-950 px-2 py-2 text-sm text-neutral-600">
							No saved chats yet
						</small>
					) : (
						props.view.conversations.map((conversation) => (
							<div className="group relative min-w-0" key={conversation.id}>
								<Button
									className={`relative z-0 w-full justify-start pl-2 pr-14 text-left ${
										conversation.active ? "bg-neutral-100 font-bold" : ""
									}`}
									type="button"
									onClick={() => props.onRestoreConversation(conversation.id)}
								>
									<span className="block w-full min-w-0 max-w-full truncate text-neutral-950">
										{conversation.title}
									</span>
								</Button>
								<Button
									aria-label={`Rename ${conversation.title}`}
									className="absolute right-8 top-1/2 z-20 !h-6 min-h-0 !w-6 -translate-y-1/2 border-neutral-950 !px-0 text-xs text-neutral-950 opacity-0 transition-opacity hover:not-data-disabled:bg-neutral-100 active:not-data-disabled:bg-neutral-200 focus-visible:outline-neutral-950 group-hover:opacity-100 focus-visible:opacity-100"
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										props.onRenameConversation(conversation.id);
									}}
								>
									r
								</Button>
								<Button
									aria-label={`Delete ${conversation.title}`}
									className="absolute right-1 top-1/2 z-20 !h-6 min-h-0 !w-6 -translate-y-1/2 border-neutral-950 !px-0 text-xs text-neutral-950 opacity-0 transition-opacity hover:not-data-disabled:bg-neutral-100 active:not-data-disabled:bg-neutral-200 focus-visible:outline-neutral-950 group-hover:opacity-100 focus-visible:opacity-100"
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										props.onDeleteConversation(conversation.id);
									}}
								>
									x
								</Button>
							</div>
						))
					)}
				</div>
			</ScrollArea>

			{props.view.provider ? (
				<div className="grid gap-2 border-t border-line-soft pt-5 text-sm">
					<span className="text-muted">Provider</span>
					<strong className="break-words text-ink">
						{props.view.provider.modelLabel}
					</strong>
					<small className="break-words leading-5 text-muted">
						{props.view.provider.baseUrlLabel}
					</small>
					<small className="leading-5 text-muted">
						{props.view.provider.cacheLabel}
					</small>
					{props.view.provider.usage ? (
						<div className="mt-2 grid gap-1 border-t border-line-soft pt-3">
							<span className="text-muted">Last usage</span>
							<strong className="text-ink">
								{props.view.provider.usage.cacheHitLabel}
							</strong>
							<small className="text-muted">
								prompt {props.view.provider.usage.promptLabel} / cached{" "}
								{props.view.provider.usage.cachedLabel}
							</small>
							<small className="text-muted">
								completion {props.view.provider.usage.completionLabel}
							</small>
						</div>
					) : null}
				</div>
			) : null}

			{props.view.tactics ? (
				<div className="grid min-w-0 gap-3 border-t border-line-soft pt-5 text-sm">
					<span className="text-muted">Tactics</span>
					<small className="text-muted">Locked for this session</small>
					{props.view.tactics.day !== null ? (
						<div className="grid gap-1 border border-neutral-950 bg-white px-3 py-2">
							<small className="text-muted">Runtime</small>
							<strong className="text-ink">Day {props.view.tactics.day}</strong>
						</div>
					) : null}
					{props.view.tactics.lastLoaded.length > 0 ? (
						<div className="grid gap-1">
							<small className="text-muted">Last loaded</small>
							{props.view.tactics.lastLoaded.map((tactic) => (
								<span
									className="truncate border border-neutral-950 bg-white px-2 py-1 text-neutral-950"
									key={tactic.id}
								>
									{tactic.name}
								</span>
							))}
						</div>
					) : (
						<small className="text-muted">No tactic loaded last turn</small>
					)}
					<div className="grid gap-2">
						{props.view.tactics.allowed.map((tactic) => (
							<span
								className="border border-neutral-950 bg-white px-3 py-2 text-neutral-950"
								key={tactic.id}
							>
								{tactic.name}
							</span>
						))}
					</div>
					<div className="grid gap-2 border-t border-line-soft pt-3">
						<small className="text-muted">Session state</small>
						{props.view.tactics.userState.map((state) => (
							<Meter key={state.key} label={state.key} value={state.value} />
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
