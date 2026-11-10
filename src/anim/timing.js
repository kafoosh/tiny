// The beats both phones share. Everything is measured from the END of a spoken frame, the
// one instant both devices know: the thrower scheduled the sound, the catcher heard it.
export const THROW_WINDUP = 0.45;     // s of wind-up inside the throw clip before release
export const RELEASE_AFTER = 150;     // ms after the frame ends that the deck leaves the hand
export const FLIGHT_OUT = 0.16;       // s from the hand to the screen edge
export const AIR_GAP = 110;           // ms "between the phones"
export const FLIGHT_IN = 0.42;        // s from the screen edge to the catching hand

/// When the throw clip must start so its release lands on the beat.
export const throwStart = (frameEnd) => frameEnd + RELEASE_AFTER - THROW_WINDUP * 1000;
/// When the deck appears at the catcher's edge.
export const catchStart = (frameEnd) => frameEnd + RELEASE_AFTER + FLIGHT_OUT * 1000 + AIR_GAP;
