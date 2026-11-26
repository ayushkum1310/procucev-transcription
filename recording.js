const SAMPLE_RATE = 16000;
const WINDOW = 16 * SAMPLE_RATE;
const FRAME = 320;
const EDGE_PADDING = Math.round(0.25 * SAMPLE_RATE);

function speechBounds(audio, count) {
  let first = -1;
  let last = 0;
  let activeFrames = 0;
  for (let start = 0; start + FRAME <= count; start += FRAME) {
    let energy = 0;
    for (let i = start; i < start + FRAME; i++) energy += audio[i] * audio[i];
    if (Math.sqrt(energy / FRAME) < 0.008) continue;
    if (first < 0) first = start;
    last = start + FRAME;
    activeFrames++;
  }
  return activeFrames >= 10
    ? [Math.max(0, first - EDGE_PADDING), Math.min(count, last + EDGE_PADDING)]
    : null;
}

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
    if (!commit && (length < 3.5 * SAMPLE_RATE || length - previewAt < 2 * SAMPLE_RATE)) return;
    const count = Math.min(length, WINDOW);
    const bounds = speechBounds(buffer, count);
    const audio = bounds && buffer.slice(...bounds);
    if (commit) {
      buffer.copyWithin(0, count, length);
      length -= count;
      previewAt = 0;
    } else {
      previewAt = length;
    }
    if (!audio) {
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
