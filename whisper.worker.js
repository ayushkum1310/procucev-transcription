import {env, pipeline} from '@huggingface/transformers';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 2)
  : 1;

const models = {
  hindi: 'di12355/whisper-hinglish-swift-onnx',
  english: 'Xenova/whisper-base',
};

let currentLanguage;
let recognizer;

async function load(language) {
  if (currentLanguage !== language) {
    if (recognizer) await (await recognizer).dispose();
    currentLanguage = language;
    recognizer = undefined;
  }
  recognizer ??= pipeline('automatic-speech-recognition', models[language], {
    device: 'wasm',
    dtype: language === 'hindi' ? {encoder_model: 'fp32', decoder_model_merged: 'q8'} : 'q8',
    progress_callback: event => {
      if (event.status === 'progress' && event.file?.endsWith('.onnx')) {
        self.postMessage({progress: Math.round(event.progress)});
      }
    },
  }).catch(error => {
    recognizer = undefined;
    throw error;
  });
  return recognizer;
}

self.onmessage = async ({data}) => {
  try {
    const transcribe = await load(data.language);
    if (!data.audio) {
      self.postMessage({ready: true});
      return;
    }
    const result = await transcribe(data.audio, {
      language: 'en',
      task: 'transcribe',
      max_new_tokens: 64,
      return_timestamps: false,
    });
    self.postMessage({text: result.text.trim()});
  } catch (error) {
    console.error(error);
    self.postMessage({error: data.audio ? 'Transcription stopped unexpectedly.' : 'Could not load Whisper. Check your internet connection and try again.'});
  }
};
