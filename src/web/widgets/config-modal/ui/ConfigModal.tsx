import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import type { StateDefinition } from "../../../entities/tactic";
import {
	buttonClassName,
	dialogBackdropClassName,
	dialogDescriptionClassName,
	dialogPopupClassName,
	dialogTitleClassName,
	tabClassName,
	tabPanelClassName,
	tabsIndicatorClassName,
	tabsListClassName,
	tabsRootClassName,
	tabsViewportClassName,
} from "../../../shared/ui";
import type { ConfigModalView, ConfigSettingsFormDraft } from "../model/types";
import { ConfigProvidersTab } from "./ConfigProvidersTab";
import { ConfigSettingsTab } from "./ConfigSettingsTab";
import { ConfigStatesTab } from "./ConfigStatesTab";
import { ConfigTacticsTab } from "./ConfigTacticsTab";

export type ConfigModalProps = {
	view: ConfigModalView;
	draft: ConfigSettingsFormDraft | null;
	error: string;
	open: boolean;
	saving: boolean;
	onDeleteProvider(providerId: string): void;
	onDeleteState(stateId: string): void;
	onDeleteTactic(tacticId: string): void;
	onEditProvider(providerId: string): void;
	onEditTactic(tacticId: string): void;
	onNewProvider(): void;
	onNewTactic(): void;
	onOpenChange(open: boolean): void;
	importStrategy: import("../../../shared/storage/import").ImportConflictStrategy;
	onExport?(): void;
	onImportStrategy?(
		strategy: import("../../../shared/storage/import").ImportConflictStrategy,
	): void;
	onImport?(
		file: File,
		strategy: import("../../../shared/storage/import").ImportConflictStrategy,
	): void;
	onSaveState(state: StateDefinition, originalId: string | null): void;
	onSubmit(): void;
	onUpdate(draft: ConfigSettingsFormDraft): void;
	onUseProvider(providerId: string): void;
};

export function ConfigModal(props: ConfigModalProps) {
	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className={`${dialogBackdropClassName} z-40`} />
				<Dialog.Popup
					className={`${dialogPopupClassName} z-50 grid max-h-[88vh] w-[min(720px,calc(100vw-3rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden`}
				>
					<div className="flex items-start justify-between gap-4 border-b border-neutral-950 p-4">
						<div>
							<Dialog.Title className={dialogTitleClassName}>
								Configuration
							</Dialog.Title>
							<Dialog.Description className={dialogDescriptionClassName}>
								Provider settings are stored in JSON and take effect on the next
								request.
							</Dialog.Description>
						</div>
						<Dialog.Close className={`${buttonClassName} shrink-0`}>
							Close
						</Dialog.Close>
					</div>

					<Tabs.Root
						className={`${tabsRootClassName} p-4 pt-3`}
						defaultValue="settings"
					>
						<Tabs.List className={tabsListClassName}>
							<Tabs.Tab className={tabClassName} value="settings">
								Settings
							</Tabs.Tab>
							<Tabs.Tab className={tabClassName} value="providers">
								Providers
							</Tabs.Tab>
							<Tabs.Tab className={tabClassName} value="tactics">
								Tactics
							</Tabs.Tab>
							<Tabs.Tab className={tabClassName} value="states">
								States
							</Tabs.Tab>
							<Tabs.Indicator className={tabsIndicatorClassName} />
						</Tabs.List>

						<div className={tabsViewportClassName}>
							<Tabs.Panel className={tabPanelClassName} value="settings">
								<ConfigSettingsTab
									activeModelLabel={props.view.activeModelLabel}
									draft={props.draft}
									error={props.error}
									modelOptions={props.view.modelOptions}
									thinkingLevelOptions={props.view.thinkingLevelOptions}
									saving={props.saving}
									importStrategy={props.importStrategy}
									onImportStrategy={props.onImportStrategy}
									onExport={props.onExport}
									onImport={props.onImport}
									onSubmit={props.onSubmit}
									onUpdate={props.onUpdate}
								/>
							</Tabs.Panel>

							<Tabs.Panel className={tabPanelClassName} value="providers">
								<ConfigProvidersTab
									error={props.error}
									providers={props.view.providers}
									saving={props.saving}
									onDeleteProvider={props.onDeleteProvider}
									onEditProvider={props.onEditProvider}
									onNewProvider={props.onNewProvider}
									onUseProvider={props.onUseProvider}
								/>
							</Tabs.Panel>

							<Tabs.Panel className={tabPanelClassName} value="tactics">
								<ConfigTacticsTab
									tactics={props.view.tactics}
									onDeleteTactic={props.onDeleteTactic}
									onEditTactic={props.onEditTactic}
									onNewTactic={props.onNewTactic}
								/>
							</Tabs.Panel>

							<Tabs.Panel className={tabPanelClassName} value="states">
								<ConfigStatesTab
									error={props.error}
									saving={props.saving}
									states={props.view.states}
									onDeleteState={props.onDeleteState}
									onSaveState={props.onSaveState}
								/>
							</Tabs.Panel>
						</div>
					</Tabs.Root>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
