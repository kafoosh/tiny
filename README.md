# Tiny

A two-phone magic trick that runs in the browser.

Two people open the same page. Each draws a little figure and says hello to it; it wakes up
and waves. A quiet tune starts. The magician's figure throws a deck of cards off the edge
of its screen; it lands on the spectator's phone, where their figure catches it. The
spectator writes any word, or draws any card, by hand. The figure shuffles the slip into
the deck and throws the deck back, and the magician's figure finds it and types it out.

It needs no internet once the page has loaded: put both phones in airplane mode and it
still works.

## Performing it

1. Both phones open the site. Magician taps **The Magician**, spectator **The Spectator**.
2. Each draws a figure and taps the yellow ✓. The screen says *say hello to your creation!*
   and the browser asks for the microphone. Say hello (any sound will do; a tap works too)
   and the figure waves back. Any drawing works; something that isn't a figure just moves
   as one piece.
3. Lay the phones side by side, magician's on the left. (The arrow button in the drawing
   toolbar changes which edge the other phone is past: right, left, or top-to-top.)
4. Magician taps their figure. The other figure waves, the spectator's phone joins the tune
   in time, and a deck appears.
5. **THROW**. The deck flies across. The spectator writes a word or draws a card (a value
   and a suit, like 7♥), taps **INTO THE DECK**, watches it get shuffled away, and taps
   **THROW IT BACK**.
6. The magician's figure catches the deck, has a think, and pulls out the selection, typed.

If a phone misses its cue it tries again by itself (up to four times). After that, tap the
page to try again. Double-tapping the top-left corner forces the next step on that phone
(the spectator's catch, or skipping the hello between phones).

Keep the phones within about half a metre, speakers unobstructed and volume up.

Ask the spectator to print clearly and fairly large, on one line. The reading is never
shown to them, so a misread only shows up at the reveal. See "Not yet proven" below.

## How it works

**The sound.** The tune is cover for a data link, and normally the link makes no sound.

- A soft four-bar loop plays: a low bed, a glockenspiel line, and a quick sparkling fill at
  the end of each loop.
- Each message is a run of 75 ms symbols (a 32nd note at the tune's tempo), four bits each,
  sent as one of 16 tones at **17.6-19.2 kHz**, which most adults can't hear. Nothing
  audible happens when the phones talk; the tune just carries on.
- If a phone turns out not to hear ultrasound (no answer, or an answer saying so), the
  message is repeated with an audible form as well: a run of two-note glockenspiel chords
  in the tune's scale. That is the same instrument, register and rhythm as the tune's own
  fill, so it sounds like another fill. Both phones then stay in that mode, and the
  glockenspiel line drops out to leave those notes clear.
- Messages carry a type, a sequence number and a CRC-16, and each is acknowledged. A card
  is one byte; a word is up to 16 characters at 5 bits each.
- Both phones know the instant a message ends, so the throw is released, and the catch
  begins, a fixed beat after it. The same instant is how the second phone locks its copy of
  the tune to the first.
- "Say hello to your creation" is how the microphone gets switched on. The figure reacts to
  any sound louder than the room.

Audio start-up and recovery (waking audio on every tap, claiming the iOS audio session,
resuming after the phone pauses it) follow `kafoosh/play`.

**The handwriting.** It is read on the spectator's phone, offline.

- Strokes are grouped into characters (touching or overlapping strokes belong together; a
  wide gap is a space).
- Each character is drawn into a 28×28 picture and classified by a small neural network
  (about 100 KB) trained on the EMNIST handwriting set plus synthetic card suits.
- A suit symbol next to one or two characters makes it a card. Otherwise it is a word, and
  if a dictionary word explains the ink nearly as well as the raw reading, the dictionary
  word wins.

Code map:

| Path | What |
|---|---|
| `src/audio/codec.js` | Modulator and streaming demodulator (pure JS, tested in Node) |
| `src/audio/music.js` | The background tune and its beat grid |
| `src/audio/engine.js` | The AudioContext and its life cycle |
| `src/audio/modem.js`, `rx-worklet.js` | Microphone, voice detection, decoding |
| `src/link/protocol.js` | Messages, ACK/retry, card and word packing |
| `src/link/loopback.js` | Test-only transport between two tabs (`?link=loopback`) |
| `src/hand/` | Stroke grouping, rasteriser, network, word list, reader |
| `tools/train-recogniser.py` | Trains the network and writes `src/hand/model-data.js` |
| `src/rig/`, `src/drawing.js` | Drawing and auto-rigging, from `kafoosh/psychic-bassoon` |
| `src/anim/` | Clip player and the clips (wake, wave, throw, catch, shuffle, reveal) |
| `src/faces.js`, `src/cards.js` | Typed card faces, word strips, the deck |
| `src/main.js` | The routine itself |
| `sw.js` | Offline cache |

## Running it

```bash
npm start
```

then open `http://localhost:8000`. The microphone only works on `https://` or `localhost`,
so to try it on two phones, deploy it (below) or serve it over HTTPS.

To watch the whole routine on one computer, open `http://localhost:8000/?link=loopback` in
two tabs of the same browser. The tabs talk to each other directly instead of through the
air (you still hear the tune and the chimes).

Other URL switches: `?debug=1` shows live per-tone levels (blue = ultrasonic, yellow =
chimes); `?edge=left|right|top` sets the layout; `?link=loopback&drop=1` simulates a lost
message and `&noultra=1` a phone that can't hear ultrasound.

```bash
npm test
```

runs the codec through a simulated noisy, echoing room (including the phone's own music in
its microphone), the protocol's retry logic, the handwriting reader on synthetic handwriting,
and the figure-rigging regression suite.

## Deploying

`.github/workflows/pages.yml` runs the tests and publishes to GitHub Pages on every push to
`main`. Enable it once under Settings → Pages → Source: GitHub Actions.

## Not yet proven

Nothing here has been tried on physical phones or with real people's handwriting.

**Audio** is verified in Node against simulated rooms and in headless Chromium against
recordings fed to the microphone. Expect to tune on real hardware, particularly:

- iOS Safari, which can lower or reroute speaker output while the microphone is open;
- how far apart the phones can be, and how loud a room it survives;
- whether the ultrasonic band is audible as a faint whine to younger spectators.

**Handwriting** is the bigger risk, because the spectator never sees what was read:

- On the EMNIST test set the network gets single letters right about 94% of the time and
  card values about 99%. In simulation with those letters, dictionary words come out right
  about 98% of the time; names and unusual words only about half the time.
- The tests here use a stroke font with wobble as stand-in handwriting, which is much
  tidier than a real person's.
- Joined-up writing, letters that touch each other, writing on more than one line, and
  numbers inside a word are not handled.

If misreads turn out to be common in practice, the least intrusive fix is a quiet read-back
on the spectator's phone before the slip goes into the deck.

## Credits

- Fonts: Share Tech Mono and Architects Daughter (SIL OFL 1.1, licences in `fonts/`).
- Handwriting data: EMNIST Balanced (Cohen, Afshar, Tapson, van Schaik, 2017).
- Word list: SCOWL levels 10-35, Copyright 2000-2016 Kevin Atkinson, via `wordlist-english`.
- Test fixture stroke font: Hershey Simplex (public domain), via `hersheytext`.

`icon.png` is a placeholder borrowed from the app the figure code came from.
