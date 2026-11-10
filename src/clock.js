// One clock for everything that has to line up across two devices' animations and audio:
// milliseconds on the page's own monotonic clock, expressed as an epoch so two tabs on one
// machine (the loopback test transport) agree too.
export const now = () => performance.timeOrigin + performance.now();
