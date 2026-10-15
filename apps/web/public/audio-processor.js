// Streaming monitor only. All decoding, source-rate DSP and conversion happen in the Rust worker.
class TonaliaPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.index = 0;
    this.offset = 0;
    this.running = false;
    this.ended = false;
    this.frames = 0;
    this.lastReport = 0;
    this.underruns = 0;
    this.volume = 1;
    this.peak = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'chunk') {
        if (this.queue.length - this.index < 16)
          this.queue.push({ samples: data.samples, channels: data.channels });
      }
      if (data.type === 'run') this.running = true;
      if (data.type === 'end') this.ended = true;
      if (data.type === 'gain') this.volume = data.value;
      if (data.type === 'stop') {
        this.running = false;
        this.queue = [];
        this.index = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    let missed = false;
    for (let f = 0; f < output[0].length; f++) {
      if (!this.running) {
        for (let c = 0; c < output.length; c++) output[c][f] = 0;
        continue;
      }
      let chunk = this.queue[this.index];
      if (chunk && this.offset >= chunk.samples.length) {
        this.queue[this.index] = null;
        this.index++;
        this.offset = 0;
        chunk = this.queue[this.index];
        this.port.postMessage({ type: 'need' });
      }
      if (!chunk) {
        for (let c = 0; c < output.length; c++) output[c][f] = 0;
        if (this.ended) {
          this.running = false;
          this.port.postMessage({ type: 'ended', frames: this.frames });
        } else {
          missed = true;
        }
        continue;
      }
      for (let c = 0; c < output.length; c++) {
        const value = chunk.samples[this.offset + Math.min(c, chunk.channels - 1)] * this.volume;
        output[c][f] = value;
        this.peak = Math.max(this.peak, Math.abs(value));
      }
      this.offset += chunk.channels;
      this.frames++;
    }
    if (missed) {
      this.underruns++;
      this.running = false;
      this.port.postMessage({ type: 'underrun' });
    }
    if (this.frames - this.lastReport >= 2048) {
      this.lastReport = this.frames;
      this.port.postMessage({
        type: 'position',
        frames: this.frames,
        peak: this.peak,
        underruns: this.underruns,
      });
      this.peak = 0;
    }
    // Compact the producer queue between chunks rather than retaining an entire recording.
    if (this.index > 8) {
      this.queue.splice(0, this.index);
      this.index = 0;
    }
    return true;
  }
}
registerProcessor('tonalia-player', TonaliaPlayer);
