/**
 * Which way the chip draws a price series. One key, because the choice is
 * about the reader and not about an asset: somebody who thinks in candles
 * thinks in candles everywhere, and asking them again on each tweet is the
 * amnesia the chip has been removing from every other surface.
 */
export const CHART_VIEW_KEY = "poppin_chart_view"
export type ChartView = "line" | "candle"
