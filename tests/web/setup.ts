import "@testing-library/jest-dom/vitest";

class ResizeObserverStub implements ResizeObserver {
	disconnect() {}
	observe() {}
	unobserve() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = ResizeObserverStub;
}

if (
	typeof HTMLElement !== "undefined" &&
	typeof HTMLElement.prototype.scrollTo === "undefined"
) {
	HTMLElement.prototype.scrollTo = () => {};
}

if (
	typeof HTMLElement !== "undefined" &&
	typeof HTMLElement.prototype.getAnimations === "undefined"
) {
	HTMLElement.prototype.getAnimations = () => [];
}
