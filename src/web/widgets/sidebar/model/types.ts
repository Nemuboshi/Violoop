export type SidebarConversationItem = {
	id: string;
	title: string;
	active: boolean;
};

export type SidebarUsageView = {
	cacheHitLabel: string;
	promptLabel: string;
	cachedLabel: string;
	completionLabel: string;
};

export type SidebarProviderView = {
	modelLabel: string;
	baseUrlLabel: string;
	cacheLabel: string;
	usage: SidebarUsageView | null;
};

export type SidebarTacticItem = {
	id: string;
	name: string;
};

export type SidebarUserStateItem = {
	key: string;
	value: number;
};

export type SidebarTacticsView = {
	day: number | null;
	lastLoaded: SidebarTacticItem[];
	allowed: SidebarTacticItem[];
	userState: SidebarUserStateItem[];
};

export type SidebarView = {
	conversations: SidebarConversationItem[];
	provider: SidebarProviderView | null;
	tactics: SidebarTacticsView | null;
};
