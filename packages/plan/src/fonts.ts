// The font list (components.md §5): the only fonts components and styles may use. Every one draws U+02BB (oʻ, gʻ)
// and U+02BC (ʼ); Google serves both in its latin subset. Adding a font: check those glyphs first, add it here, then
// run `npm run fonts` (renders load local files only).
export const FONT_LIST: Record<string, {weights: number[]; italic?: number[]; kind: string}> = {
  Onest: {weights: [400, 500, 600, 700, 800, 900], kind: 'geometric grotesque sans (clean, modern)'},
  Montserrat: {weights: [400, 500, 600, 700, 800, 900], italic: [700, 800, 900], kind: 'geometric sans, wide and heavy at 800–900'},
  'Bebas Neue': {weights: [400], kind: 'tall condensed caps display (titles, chapter headings)'},
  'Inter Tight': {weights: [500, 600, 700, 800, 900], kind: 'tight neo-grotesque (clean UI titles, the clean-motion scenes)'},
  Inter: {weights: [400, 500, 600, 700], kind: 'neutral UI sans (labels, small text)'},
  'League Gothic': {weights: [400], kind: 'ultra-condensed grotesque caps (giant chapter titles, reference5)'},
  'Big Shoulders Display': {weights: [800, 900], kind: 'heavy condensed display (giant chapter titles, the closest free match to reference5)'},
};

/** Problems with a font + weight (empty when it's on the list). */
export const fontIssue = (font: string, weight: number, italic = false): string | null => {
  const f = FONT_LIST[font];
  if (!f) return `font "${font}" isn't on the font list (${Object.keys(FONT_LIST).join(', ')})`;
  const ws = italic ? f.italic ?? [] : f.weights;
  return ws.includes(weight) ? null : `${font} has no ${italic ? 'italic ' : ''}weight ${weight} (has ${ws.join(', ')})`;
};
