const SAMPLE_RATE = 16000;
const WINDOW = 12 * SAMPLE_RATE;

export function record(worker, language, {onState, onText, onLevel, onFinish}) {
  let context, stream, node, closed = false, ending = false, flushed = false;
  let pending, previewAt = 0, length = 0, text = '';
  const completed = [];
  const buffer = new Float32Array(WINDOW * 2);

  function releaseMic() {
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') context.close().catch(() => {});
  }

  function finish(message) {
    if (closed) return;
    closed = true;
    releaseMic();
    worker.onmessage = null;
    worker.onerror = null;
    onFinish(message);
  }

  function advance() {
    if (pending || closed) return;
    const commit = length >= WINDOW || flushed;
    if (!commit && (length < 2.5 * SAMPLE_RATE || length - previewAt < 2 * SAMPLE_RATE)) return;
    const count = Math.min(length, WINDOW);
    const audio = buffer.slice(0, count);
    if (commit) {
      buffer.copyWithin(0, count, length);
      length -= count;
      previewAt = 0;
    } else {
      previewAt = length;
    }
    const hasSpeech = audio.some(sample => Math.abs(sample) > 0.012);
    if (!hasSpeech) {
      if (flushed && !length) finish(text ? 'Recording complete.' : 'No speech was detected.');
      else if (flushed) advance();
      return;
    }
    pending = {commit};
    worker.postMessage({audio, language}, [audio.buffer]);
  }

  async function openMic() {
    try {
      onState('Opening microphone');
      await context.audioWorklet.addModule('/mic-worklet.js');
      await context.resume();
      if (closed) return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {channelCount: 1, echoCancellation: true}, video: false,
      });
      if (closed) return releaseMic();
      node = new AudioWorkletNode(context, 'microphone-capture');
      node.port.onmessage = ({data}) => {
        if (closed) return;
        if (data === 'stopped') {
          flushed = true;
          releaseMic();
          advance();
          return;
        }
        if (length + data.length > buffer.length) {
          finish('This device could not keep up. You can save the text already shown.');
          return;
        }
        const rms = Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
        onLevel(Math.min(1, rms * 8));
        buffer.set(data, length);
        length += data.length;
        advance();
      };
      context.createMediaStreamSource(stream).connect(node);
      node.connect(context.destination);
      onState('Recording');
    } catch (error) {
      finish(error.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser and try again.'
        : 'Could not open the microphone. Check your audio device and try Chrome.');
    }
  }

  worker.onmessage = ({data}) => {
    if (closed) return;
    if (data.error) return finish(data.error);
    if (data.ready) return void openMic();
    if (typeof data.progress === 'number') return onState(`Loading Whisper · ${data.progress}%`);
    if (pending && typeof data.text === 'string') {
      if (pending.commit && data.text) completed.push(data.text);
      if (data.text || pending.commit) {
        text = [...completed, pending.commit ? '' : data.text].filter(Boolean).join(' ');
        onText(text);
      }
      pending = null;
      advance();
    }
  };
  worker.onerror = () => finish('Whisper could not start. Reload the page and try again.');

  try {
    context = new AudioContext({sampleRate: SAMPLE_RATE});
    if (context.sampleRate !== SAMPLE_RATE) throw new Error('Unsupported sample rate');
    onState('Loading Whisper');
    worker.postMessage({language});
  } catch {
    queueMicrotask(() => finish('This browser cannot capture audio at 16 kHz. Try desktop Chrome.'));
  }

  return {
    stop() {
      if (!node || ending || closed) return;
      ending = true;
      onState('Finishing');
      node.port.postMessage('stop');
    },
    cancel() {
      finish('Recording canceled.');
    },
  };
}
