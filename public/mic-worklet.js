class MicrophoneCapture extends AudioWorkletProcessor {
  block = new Float32Array(4000);
  written = 0;
  stopped = false;

  constructor() {
    super();
    this.port.onmessage = () => {
      this.stopped = true;
      this.send();
      this.port.postMessage('stopped');
    };
  }

  send() {
    if (!this.written) return;
    const audio = this.block.slice(0, this.written);
    this.port.postMessage(audio, [audio.buffer]);
    this.written = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    for (const sample of inputs[0]?.[0] ?? []) {
      this.block[this.written++] = sample;
      if (this.written === this.block.length) this.send();
    }
    return true;
  }
}

registerProcessor('microphone-capture', MicrophoneCapture);
