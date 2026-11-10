// Blueprint: deep drafting blue, a pale grid, white technical pen, and cut-out white paper
// for anything that is a card.

export const BP = Object.freeze({
  sheet: '#17335F',      // the drawing sheet
  sheetDeep: '#102648',  // shadows, and ink on white paper
  line: '#F4F8FF',       // the white pen (default figure ink, borders, labels)
  cyan: '#7FD3FF',       // construction lines, hints
  yellow: '#FFD75E',     // the one accent: what to press next
  coral: '#FF8E7A',      // a warm pen
  paper: '#F6F9FF',      // cards and slips
  red: '#D8342C',        // hearts and diamonds on paper
});

export const PENS = [BP.line, BP.cyan, BP.yellow, BP.coral];

export const FONT_HAND = '"Architects Daughter"';   // drafting hand: hints and labels
export const FONT_TYPE = '"Share Tech Mono"';       // typed: the reveal
