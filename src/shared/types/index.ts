export type ChatRole = "system" | "developer" | "user" | "assistant";

export type ChatMessage = {
	role: ChatRole;
	content: string;
};

export type ChatRequest = {
	conversationId: string;
	message?: string;
};

export type SessionProfile = {
	assistantName: string;
	userRole: string;
	assistantRole: string;
};

export type CreateConversationRequest = {
	title?: string;
	profile?: SessionProfile;
	allowedTacticIds?: string[];
	enabledStateIds?: string[];
};

export type RenameConversationRequest = {
	title?: string;
};

export type ConversationSummary = {
	id: string;
	title: string;
	profile: SessionProfile;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
};

export type TimelineItemKind =
	| "chat"
	| "scene"
	| "day_transition"
	| "state_update";

export type TimelineRole = "user" | "assistant" | "system";

export type PromptVisibility = "visible" | "context" | "hidden";

export type TimelineItem = {
	id: string;
	conversationId: string;
	kind: TimelineItemKind;
	role: TimelineRole;
	speakerName?: string;
	content: string;
	promptVisibility: PromptVisibility;
	metadata?: Record<string, unknown>;
	createdAt: string;
	usage?: ChatUsage;
};

export type SessionClock = {
	conversationId: string;
	day: number;
	stateUpdatedDay?: number;
	updatedAt: string;
};

export type ProviderApi = "openai-completions";

export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export type ThinkingFormat =
	| "openai"
	| "openrouter"
	| "qwen"
	| "qwen-chat-template"
	| "deepseek"
	| "together"
	| "zai"
	| "string-thinking";

export type ProviderCompat = {
	supportsDeveloperRole?: boolean;
	supportsUsageInStreaming?: boolean;
	cacheControlFormat?: "anthropic";
	supportsLongCacheRetention?: boolean;
	supportsReasoningEffort?: boolean;
	thinkingFormat?: ThinkingFormat;
};

export type ProviderModelConfig = {
	id: string;
	name?: string;
	api?: ProviderApi;
	reasoning?: boolean;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
	compat?: ProviderCompat;
};

export type ProviderConfig = {
	name?: string;
	baseUrl: string;
	api: ProviderApi;
	apiKey?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	models?: ProviderModelConfig[];
	compat?: ProviderCompat;
};

export type VioloopConfig = {
	chat: {
		defaultProvider: string;
		defaultModel: string;
		systemPrompt: string;
		temperature?: number;
		thinkingLevel?: ThinkingLevel;
		cache?: {
			systemPrompt?: boolean;
			promptCacheRetention?: string;
		};
		compaction: {
			enabled: boolean;
			triggerTokens: number;
			keepRecentTokens: number;
		};
	};
	providers: Record<string, ProviderConfig>;
};

export type ConfigResponse = {
	config: VioloopConfig;
	provider: string;
	providerName: string;
	baseUrl: string;
	api: ProviderApi;
	model: string;
	cache?: {
		systemPrompt: boolean;
		cacheControlFormat?: string;
		usageInStreaming: boolean;
	};
};

export type ConfigSaveResponse = {
	config: VioloopConfig;
};

export type ProviderTestRequest = {
	providerId?: string;
	provider?: ProviderConfig;
	model?: string;
};

export type ProviderTestResponse = {
	ok: boolean;
	provider: string;
	model: string;
	text?: string;
	usage?: ChatUsage;
};

export type ActiveProvider = {
	id: string;
	name: string;
	baseUrl: string;
	api: ProviderApi;
	model: ProviderModelConfig;
	apiKey?: string;
	authHeader: boolean;
	headers: Record<string, string>;
	compat: ProviderCompat;
};

export type StreamChatOptions = {
	provider: ActiveProvider;
	messages: ChatMessage[];
	promptBlocks: PromptBlock[];
	temperature?: number;
	thinkingLevel?: ThinkingLevel;
	cache?: VioloopConfig["chat"]["cache"];
};

export type PromptBlock = {
	label: "stable-system" | "session-profile" | "dynamic-runtime";
	content: string;
	cacheScope?: "stable" | "session";
};

export type ChatUsage = {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	cachedPromptTokens?: number;
	cacheHitRate?: number;
};

export type ChatResponse = {
	requestId: string;
	conversationId: string;
	tacticIds: string[];
	compactionId?: string;
	usage?: ChatUsage;
	clock: SessionClock;
	timelineItems: TimelineItem[];
	createdItems: TimelineItem[];
};

export type ChatStreamEvent =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "usage";
			usage: ChatUsage;
	  };

export type ChatProviderAdapter = {
	streamChat(options: StreamChatOptions): AsyncGenerator<ChatStreamEvent>;
};

export type StateDefinition = {
	id: string;
	name: string;
	description?: string;
	defaultValue: number;
};

export type TacticEmotionKey = string;

export type TacticEmotionRule = {
	key: TacticEmotionKey;
	operator: ">=" | "<=";
	value: number;
};

export type TacticEmotionOperator = TacticEmotionRule["operator"];

export type Tactic = {
	id: string;
	name: string;
	keywords: string[];
	emotionRules: TacticEmotionRule[];
	blockedKeywords: string[];
	instruction: string;
};

export type TacticOverview = Tactic & {
	allowedInSession: boolean;
	requiredStateIds: string[];
	updatedAt?: string;
};

export type UserStateSource = "explicit" | "inferred" | "observed";

export type UserState = {
	key: TacticEmotionKey;
	value: number;
	source: UserStateSource;
	confidence: number;
	updatedAt: string;
};

export type TacticRunLogEntry = {
	id: string;
	conversationId?: string | null;
	messageId?: string | null;
	tacticId: string;
	score: number;
	loaded: boolean;
	decision: "loaded" | "skipped";
	reason: {
		reasons: string[];
		matchedKeywords: string[];
		contraindications: string[];
	};
	createdAt: string;
};

export type ConversationsResponse = {
	conversations: ConversationSummary[];
};

export type ConversationPayload = {
	conversation: ConversationSummary;
	clock: SessionClock;
	timelineItems: TimelineItem[];
};

export type TacticsStatusResponse = {
	conversationId?: string;
	tactics: TacticOverview[];
	stateDefinitions: StateDefinition[];
	userState: UserState[];
	clock: SessionClock | null;
	recentRuns: TacticRunLogEntry[];
};

export type TacticsMutationResponse = {
	tactics: TacticOverview[];
	stateDefinitions: StateDefinition[];
};

export type LoadedTactic = {
	id: string;
	name: string;
	score: number;
	keywords: string[];
	emotionRules: TacticEmotionRule[];
	blockedKeywords: string[];
	instruction: string;
};
