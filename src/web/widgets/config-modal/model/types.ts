export type ConfigSelectOption = {
	label: string;
	value: string;
};

export type ConfigSettingsFormDraft = {
	defaultModel: string;
	temperature: string;
	thinkingLevel: string;
	systemPrompt: string;
	systemPromptCache: boolean;
	compactionEnabled: boolean;
	compactionTriggerTokens: string;
	compactionKeepRecentTokens: string;
};

export type ConfigProviderListItem = {
	id: string;
	name: string;
	baseUrl: string;
	modelsLabel: string;
	active: boolean;
};

export type ConfigTacticListItem = {
	id: string;
	name: string;
	keywordsLabel: string;
};

export type ConfigStateListItem = {
	id: string;
	name: string;
	description: string;
	defaultValue: number;
};

export type ConfigModalView = {
	modelOptions: ConfigSelectOption[];
	thinkingLevelOptions: ConfigSelectOption[];
	activeModelLabel: string;
	providers: ConfigProviderListItem[] | null;
	tactics: ConfigTacticListItem[];
	states: ConfigStateListItem[];
};
