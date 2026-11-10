// Every clip the figures can perform, bound to one kit.

import { wake, idle, wave, cheer } from './basics.js';
import { produce, throwDeck, catchDeck, fan, shuffle } from './deck.js';
import { showPick, reveal } from './reveal.js';

export class ClipLibrary {
  constructor(kit) { this.kit = kit; }
  wake() { return wake(this.kit); }
  idle(hold = 'none') { return idle(this.kit, hold); }
  wave() { return wave(this.kit); }
  cheer(hold = 'none') { return cheer(this.kit, hold); }
  produce() { return produce(this.kit); }
  throwDeck() { return throwDeck(this.kit); }
  catchDeck() { return catchDeck(this.kit); }
  fan() { return fan(this.kit); }
  shuffle() { return shuffle(this.kit); }
  showPick(writing) { return showPick(this.kit, writing); }
  reveal(sel) { return reveal(this.kit, sel); }
}

/// Clip names with no arguments beyond a selection — used by the tests to sweep them all.
export const CLIP_NAMES = ['wake', 'idle', 'wave', 'cheer', 'produce', 'throwDeck', 'catchDeck',
  'fan', 'shuffle', 'showPick', 'reveal'];
