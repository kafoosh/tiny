// Microphone tap. Runs on the audio thread and only batches samples: the demodulator itself
// lives on the main thread (so it is the same code the tests exercise). Each batch carries
// the context frame it started at, so timing stays sample-exact however late it is handled.
class RxTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.start = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.n === 0) this.start = currentFrame;
    if (this.n + ch.length > this.size) this.n = 0;
    this.buf.set(ch, this.n);
    this.n += ch.length;
    if (this.n >= this.size) {
      this.port.postMessage({ pcm: this.buf, frame: this.start }, [this.buf.buffer]);
      this.buf = new Float32Array(this.size);
      this.n = 0;
    }
    return true;
  }
}
registerProcessor('rx-tap', RxTap);
