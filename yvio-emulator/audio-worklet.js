// AudioWorklet that plays the console's PCM: 22050 Hz signed 16-bit mono chunks arrive on a
// MessagePort from the emulator worker. It keeps a small FIFO, resamples linearly to the
// context rate and drops old audio if the FIFO grows (clock drift between wall time and the
// sound card), so latency stays bounded.

const SOURCE_RATE = 22050;
const MAX_QUEUED = SOURCE_RATE * 0.25;   // above this, drop down to TARGET_QUEUED
const TARGET_QUEUED = SOURCE_RATE * 0.08;

class YvioAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {Int16Array[]} */
    this.queue = [];
    this.offset = 0;     // read position in queue[0]
    this.queued = 0;     // samples queued
    this.step = SOURCE_RATE / sampleRate;
    this.frac = 0;
    this.prev = 0;
    this.cur = 0;
    this.volume = 1;
    this.underruns = 0;    // number of gaps (FIFO ran empty while audio was flowing)
    this.starved = true;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'source') data.port.onmessage = ev => this.push(ev.data);
      else if (data.type === 'volume') this.volume = data.value;
      else if (data.type === 'stats') this.port.postMessage({ type: 'stats', queued: this.queued, underruns: this.underruns });
    };
  }

  push(chunk) {
    this.queue.push(chunk);
    this.queued += chunk.length;
    while (this.queued > MAX_QUEUED && this.queue.length > 1) {
      const drop = this.queue.shift();
      this.queued -= drop.length - this.offset;
      this.offset = 0;
      if (this.queued <= TARGET_QUEUED) break;
    }
  }

  next() {
    while (this.queue.length && this.offset >= this.queue[0].length) { this.queue.shift(); this.offset = 0; }
    if (!this.queue.length) {
      if (!this.starved) { this.starved = true; this.underruns++; }
      return this.cur * 0.98; // fade out instead of clicking
    }
    this.starved = false;
    this.queued--;
    return this.queue[0][this.offset++] / 32768;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    for (let i = 0; i < ch0.length; i++) {
      this.frac += this.step;
      while (this.frac >= 1) { this.prev = this.cur; this.cur = this.next(); this.frac -= 1; }
      ch0[i] = (this.prev + (this.cur - this.prev) * this.frac) * this.volume;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}

registerProcessor('yvio-audio', YvioAudio);
