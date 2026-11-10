# Tiny

A two-phone magic trick that runs in the browser.

Two people open the same page. Each draws a little figure. The figures come to life, chirp
at each other, and the magician's figure throws a deck of cards off the edge of its screen;
it lands on the spectator's phone, where their figure catches it. The spectator picks any
card (or writes any word), the figure shuffles it into the deck and throws the deck back,
and the magician's figure finds it.

It needs no internet once the page has loaded: put both phones in airplane mode and it
still works.

## Performing it

1. Both phones open the site. Magician taps **I'm the magician**, spectator taps
   **I'm the spectator**.
2. Each draws a figure and taps the orange ✓. The first time, the browser asks for the
   microphone ("so your little guy can hear its friend"). Any drawing works; something
   that isn't a figure just moves as one piece.
3. Lay the phones side by side, magician's on the left. (The arrow button in the drawing
   toolbar changes which edge the other phone is past: right, left, or top-to-top.)
4. Magician taps their figure: it says hello, the other one waves back, and a deck appears.
5. **THROW!** The deck flies across. The spectator picks a card or writes a word, watches
   it get shuffled away, and taps **THROW IT BACK!**
6. The magician's figure catches the deck, has a think, and pulls out the selection.

If a phone misses its cue the figure just calls out again (up to four times). After that,
tap the page to try again. Double-tapping the top-left corner forces the next step on that
phone (the spectator's catch, or skipping the hello).

Keep the phones within about half a metre, speakers unobstructed, volume up, and silent
mode off.

## How it works

The chirping is a data link.

- Each "sentence" is a frame of 50 ms notes, 16 possible pitches per note (4 bits), sent in
  two bands at once: **17.6-19.4 kHz**, which most adults can't hear, and **2.2-4.3 kHz**,
  the audible voice.
- First try, the data rides only in the inaudible band and the audible voice is a random
  melody. If the other phone doesn't answer, the figure says it again with the data in the
  audible notes too, and the pair stay in that mode. Some phones can't play or record
  near-ultrasound; this is what keeps the trick working on them.
- Frames carry a type, a sequence number and a CRC-16, and every one is acknowledged. A card
  is one byte; a word is up to 16 characters at 5 bits each.
- Both phones know the instant a frame ends, so the throw is released, and the catch begins,
  a fixed beat after it. No clocks are shared.

Code map:

| Path | What |
|---|---|
| `src/audio/codec.js` | Modulator and streaming demodulator (pure JS, tested in Node) |
| `src/audio/modem.js`, `rx-worklet.js` | Speaker + microphone via Web Audio |
| `src/link/protocol.js` | Messages, ACK/retry, card and word packing |
| `src/link/loopback.js` | Test-only transport between two tabs (`?link=loopback`) |
| `src/rig/`, `src/drawing.js`, `src/reveal.js`, `src/anim/sketchInk.js` | Drawing, auto-rigging and sketch rendering, from `kafoosh/psychic-bassoon` |
| `src/anim/actor.js`, `src/anim/routines/` | Clip player and the clips (wake, wave, throw, catch, shuffle, reveal) |
| `src/main.js` | The routine itself |
| `sw.js` | Offline cache |

## Running it

```bash
npm start
```

then open `http://localhost:8000`. The microphone only works on `https://` or `localhost`,
so to try it on two phones, deploy it (below) or serve it over HTTPS.

To watch the whole routine on one computer without any sound, open
`http://localhost:8000/?link=loopback` in two tabs of the same browser.

Other URL switches: `?debug=1` shows live per-tone levels (purple = ultrasonic, orange =
audible); `?edge=left|right|top` sets the layout; `?link=loopback&noultra=1` and `&drop=1`
simulate a phone without ultrasound and a lost message.

```bash
npm test
```

runs the codec through a simulated noisy, echoing room, the protocol's retry logic, and the
figure-rigging regression suite.

## Deploying

`.github/workflows/pages.yml` runs the tests and publishes to GitHub Pages on every push to
`main`. Enable it once under Settings → Pages → Source: GitHub Actions.

## Not yet proven

The audio link is verified in Node against simulated rooms and in headless Chromium against
recorded chirps fed to the microphone. It has **not** been tried on physical phones. Expect
to tune on real hardware, particularly:

- iOS Safari, which can lower or reroute speaker output while the microphone is open;
- how far apart the phones can be, and how loud a room it survives;
- whether the ultrasonic band is audible as a faint whine to younger spectators.

`icon.png` is a placeholder borrowed from the app the figure code came from.

Font: Gochi Hand (SIL OFL 1.1, see `fonts/OFL.txt`).
