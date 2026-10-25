export const ROW_PADDING = 10;
export const BUBBLE_PADDING = 9;
export const BUBBLE_MAX_RATIO = 0.82;
export const CAROUSEL_CARD_W = 200;
export const CAROUSEL_SNAP = 208;

export const carouselViewportWidth = (screen: number) =>
  Math.max(160, Math.min(BUBBLE_MAX_RATIO * (screen - ROW_PADDING * 2) - BUBBLE_PADDING * 2, 440));

export const singleImageWidth = (screen: number) => Math.min(240, screen * 0.7);
