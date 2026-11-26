class PCMRecorder extends AudioWorkletProcessor {
  buffer = new Int16Array(4000);
  cursor = 0;
  stopped = false;

  constructor() {
    super();
    this.port.onmessage = ({data}) => {
      if (data !== 'flush' || this.stopped) return;
      this.stopped = true;
      this.send();
      this.port.postMessage('flushed');
    };
  }

  send() {
    if (!this.cursor) return;
    const pcm = this.buffer.slice(0, this.cursor).buffer;
    this.port.postMessage(pcm, [pcm]);
    this.cursor = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    for (const sample of inputs[0]?.[0] ?? []) {
      const clipped = Math.max(-1, Math.min(1, sample));
      this.buffer[this.cursor++] = clipped * (clipped < 0 ? 32768 : 32767);
      if (this.cursor === this.buffer.length) this.send();
    }
    return true;
  }
}
registerProcessor('pcm', PCMRecorder);
