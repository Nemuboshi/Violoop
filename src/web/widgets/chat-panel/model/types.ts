export type ChatTimelineItemView = {
	id: string;
	itemClassName: string;
	speakerClassName: string;
	speaker: string;
	contentClassName: string;
	content: string;
	editable?: boolean;
	editing?: boolean;
	editValue?: string;
};
