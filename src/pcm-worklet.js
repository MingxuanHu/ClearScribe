/* Emits small blocks; no microphone audio is copied to outputs. */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1024);
    this.offset = 0;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        if (this.offset) this.port.postMessage(this.block.slice(0, this.offset));
        this.offset = 0;
        this.port.postMessage('flushed');
      }
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.block[this.offset++] = sample;
      if (this.offset === this.block.length) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(1024); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('clearscribe-pcm', PCMProcessor);
