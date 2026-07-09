export const buttonClassName =
	"box-border flex h-8 min-w-0 items-center justify-center gap-2 rounded-none border border-neutral-950 bg-white px-3 text-sm leading-none whitespace-nowrap font-normal text-neutral-950 select-none hover:not-data-disabled:bg-neutral-100 active:not-data-disabled:bg-neutral-200 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-neutral-950 data-disabled:border-neutral-500 data-disabled:text-neutral-500 disabled:border-neutral-500 disabled:text-neutral-500 disabled:cursor-not-allowed";

export const inputClassName =
	"box-border h-8 w-full min-w-0 self-stretch rounded-none border border-neutral-950 bg-white px-2 text-sm font-normal text-neutral-950 placeholder:text-neutral-500 outline-none focus:outline-2 focus:-outline-offset-1 focus:outline-neutral-950 data-invalid:border-red-700 data-[invalid]:border-red-700";

export const fieldRootClassName =
	"flex w-full min-w-0 flex-col items-start gap-1";
export const fieldLabelClassName = "text-sm font-bold text-neutral-950";
export const fieldErrorClassName = "text-sm text-red-700";

export const dialogBackdropClassName =
	"fixed inset-0 min-h-dvh bg-black opacity-20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute";

export const dialogPopupClassName =
	"fixed left-1/2 top-1/2 max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 border border-neutral-950 bg-white text-neutral-950 shadow-[0.25rem_0.25rem_0] shadow-black/12 outline-none transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0";

export const dialogTitleClassName = "text-base font-bold text-neutral-950";
export const dialogDescriptionClassName = "text-sm leading-6 text-neutral-600";

export const popoverPopupClassName =
	"relative origin-[var(--transform-origin)] border border-neutral-950 bg-white p-3 text-neutral-950 shadow-[0.25rem_0.25rem_0] shadow-black/12 outline-none transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0";

export const popoverArrowClassName =
	"relative block h-1.5 w-3 overflow-clip data-[side=bottom]:top-[-6px] data-[side=left]:right-[-9px] data-[side=left]:rotate-90 data-[side=right]:left-[-9px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-6px] data-[side=top]:rotate-180 before:absolute before:bottom-0 before:left-1/2 before:h-[calc(6px*sqrt(2))] before:w-[calc(6px*sqrt(2))] before:border before:border-neutral-950 before:bg-white before:content-[''] before:[transform:translate(-50%,50%)_rotate(45deg)]";

export const tabsRootClassName = "grid min-h-0 grid-rows-[auto_minmax(0,1fr)]";
export const tabsListClassName = "relative z-[1] -mb-px flex gap-1";
export const tabClassName =
	"relative flex h-[calc(2rem+1px)] items-center justify-center bg-transparent px-2 py-0 text-sm font-normal leading-5 whitespace-nowrap text-neutral-600 outline-none select-none hover:text-neutral-950 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-neutral-950 data-[active]:text-neutral-950";
export const tabsIndicatorClassName =
	"absolute left-0 top-0 -z-[1] h-full w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] border-x border-t border-neutral-950 bg-white transition-[translate,width] duration-150 ease-in-out";
export const tabsViewportClassName =
	"grid w-full min-h-0 grid-cols-1 overflow-hidden border border-neutral-950";
export const tabPanelClassName =
	"col-start-1 row-start-1 min-h-0 bg-white text-neutral-950 outline-none focus-visible:z-[1] focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-neutral-950 [[hidden]]:hidden";
