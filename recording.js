export function record(language, {onState, onText, onLevel, onFinish}) {
  const endpoint = new URL('/ws/transcribe', location.href);
  endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  endpoint.searchParams.set('lang', language);
  const socket = new WebSocket(endpoint);
  let context, stream, node, closed = false, ending = false;
  let count = 0;

  function releaseMic() {
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') context.close().catch(() => {});
  }

  function finish(message) {
    if (closed) return;
    closed = true;
    releaseMic();
    socket.close();
    onFinish(message);
  }

  async function openMic() {
    try {
      onState('Opening microphone');
      await context.audioWorklet.addModule('/mic-worklet.js');
      await context.resume();
      if (closed) return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true},
        video: false,
      });
      if (closed) return releaseMic();
      node = new AudioWorkletNode(context, 'microphone-capture');
      node.port.onmessage = ({data}) => {
        if (closed || socket.readyState !== WebSocket.OPEN) return;
        if (data === 'stopped') {
          releaseMic();
          socket.send('stop');
          return;
        }
        if (socket.bufferedAmount > 128000) {
          finish('The connection is too slow. You can save the text already shown.');
          return;
        }
        const pcm = new Int16Array(data.length);
        let energy = 0;
        for (let i = 0; i < data.length; i++) {
          const sample = Math.max(-1, Math.min(1, data[i]));
          pcm[i] = Math.round(sample * 32767);
          energy += sample * sample;
        }
        onLevel(Math.min(1, Math.sqrt(energy / data.length) * 8));
        socket.send(pcm);
      };
      context.createMediaStreamSource(stream).connect(node);
      node.connect(context.destination);
      onState('Recording');
    } catch (error) {
      finish(error.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser and try again.'
        : 'Could not open the microphone. Check your audio device.');
    }
  }

  socket.onmessage = ({data}) => {
    if (closed) return;
    const message = JSON.parse(data);
    if (message.error) return finish(message.error);
    if (message.ready) return void openMic();
    if (message.warming) return onState('Preparing speech model');
    if (message.committed) {
      count++;
      onText(message.committed);
    }
    if (message.done) finish(count ? 'Recording complete.' : 'No speech was detected.');
  };
  socket.onclose = () => finish('The transcription connection closed. You can save the text already shown.');

  try {
    context = new AudioContext({sampleRate: 16000});
    if (context.sampleRate !== 16000) throw new Error('Unsupported sample rate');
    // Start resuming during the button gesture, before waiting for the server.
    context.resume().catch(() => {});
    onState('Connecting');
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
