import { Button, ScrollArea } from "../../../shared/ui";
import type { ConfigProviderListItem } from "../model/types";

export function ConfigProvidersTab(props: {
	error: string;
	providers: ConfigProviderListItem[] | null;
	saving: boolean;
	onDeleteProvider(providerId: string): void;
	onEditProvider(providerId: string): void;
	onNewProvider(): void;
	onUseProvider(providerId: string): void;
}) {
	return (
		<ScrollArea className="min-h-0" contentClassName="grid gap-4 p-4">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h3 className="text-base font-semibold text-ink">Providers</h3>
					<p className="mt-1 text-sm text-muted">
						Manage global model providers. New sessions and requests use the
						active provider.
					</p>
				</div>
				<Button
					className="shrink-0"
					type="button"
					variant="primary"
					onClick={props.onNewProvider}
				>
					New provider
				</Button>
			</div>

			<div className="grid gap-2">
				{props.providers ? (
					props.providers.map((provider) => (
						<div
							className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-neutral-950 bg-white px-3 py-2"
							key={provider.id}
						>
							<div className="min-w-0">
								<strong className="block truncate text-sm text-ink">
									{provider.name}
									{provider.active ? " / Active" : ""}
								</strong>
								<small className="block truncate text-muted">
									{provider.baseUrl}
								</small>
								<small className="block truncate text-muted">
									{provider.modelsLabel}
								</small>
							</div>
							<div className="flex flex-wrap justify-end gap-2">
								<Button
									disabled={provider.active || props.saving}
									type="button"
									onClick={() => props.onUseProvider(provider.id)}
								>
									Use
								</Button>
								<Button
									type="button"
									onClick={() => props.onEditProvider(provider.id)}
								>
									Edit
								</Button>
								<Button
									disabled={provider.active || props.saving}
									type="button"
									variant="danger"
									onClick={() => props.onDeleteProvider(provider.id)}
								>
									Delete
								</Button>
							</div>
						</div>
					))
				) : (
					<div className="grid min-h-32 place-items-center border border-dashed border-neutral-950 text-sm text-neutral-600">
						Loading providers.
					</div>
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
