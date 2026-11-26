import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
function microphoneIssue() {
  if (!window.isSecureContext) return 'Microphone access needs HTTPS or localhost.';
  const policy = document.permissionsPolicy ?? document.featurePolicy;
  if (policy?.allowsFeature('microphone') === false) {
    return 'This preview blocks microphone access. Copy the page link and open it directly in Chrome.';
  }
  if (!SpeechRecognition) {
    return 'This browser does not provide speech recognition. Copy the page link and open it directly in Chrome.';
  }
  return '';
}

const storageKey = 'speech-desk.transcripts.v1';
const messages = {
  'not-allowed': 'Allow microphone access in your browser and try again.',
  'audio-capture': 'Check that your microphone is connected and available.',
  'network': 'The browser speech service could not connect. Check your internet connection.',
  'no-speech': 'No speech detected. Try speaking closer to the microphone.',
  'language-not-supported': 'The selected language is unavailable in this browser.',
  'service-not-allowed': 'Speech recognition is unavailable. Try Chrome.',
};

function App() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({title: '', body: ''});
  const [language, setLanguage] = useState('hi-IN');
  const [state, setState] = useState('Ready');
  const [notice, setNotice] = useState('');
  const current = useRef(null);
  const active = state !== 'Ready';
  const microphoneUnavailable = microphoneIssue();

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(saved)) setItems(saved);
    } catch {
      setNotice('Could not read transcription history in this browser.');
    }
    return () => {
      const session = current.current;
      current.current = null;
      clearTimeout(session?.openTimer);
      session?.engine.abort();
    };
  }, []);

  function start() {
    if (current.current) return;
    if (microphoneUnavailable) {
      setNotice(microphoneUnavailable);
      return;
    }
    const engine = new SpeechRecognition();
    engine.lang = language;
    engine.continuous = true;
    engine.interimResults = true;
    const session = {engine, text: ''};
    current.current = session;
    setNotice('');
    setState('Opening microphone');
    engine.onstart = () => {
      if (current.current !== session) return;
      clearTimeout(session.openTimer);
      setDraft({title: '', body: ''});
      setState('Recording');
    };
    engine.onresult = ({results}) => {
      if (current.current !== session) return;
      session.text = Array.from(results, result => result[0]?.transcript.trim()).filter(Boolean).join(' ');
      setDraft(previous => ({...previous, body: session.text}));
    };
    engine.onerror = ({error}) => {
      if (current.current !== session) return;
      clearTimeout(session.openTimer);
      current.current = null;
      setState('Ready');
      setNotice(messages[error] ?? 'Speech recognition ended. Try again.');
    };
    engine.onend = () => {
      if (current.current !== session) return;
      clearTimeout(session.openTimer);
      current.current = null;
      setState('Ready');
      setNotice(session.text ? 'Recording complete.' : 'No speech detected.');
    };
    try {
      session.openTimer = setTimeout(() => {
        if (current.current === session) cancel('The microphone did not start. Check permission and try again.');
      }, 12000);
      engine.start();
    } catch {
      clearTimeout(session.openTimer);
      current.current = null;
      setState('Ready');
      setNotice('Could not start speech recognition. Check microphone access.');
    }
  }

  function cancel(message) {
    const session = current.current;
    if (!session) return;
    current.current = null;
    clearTimeout(session.openTimer);
    session.engine.abort();
    setState('Ready');
    setNotice(message);
  }

  function stop() {
    if (!current.current) return;
    setState('Finishing');
    try {
      current.current.engine.stop();
    } catch {
      current.current = null;
      setState('Ready');
    }
  }

  function persist(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setItems(next);
      return true;
    } catch {
      setNotice('Could not save to this browser. Check its storage settings.');
      return false;
    }
  }

  function save() {
    const entry = {
      id: draft.id ?? crypto.randomUUID(),
      title: draft.title.trim() || draft.body.trim().slice(0, 60),
      body: draft.body.trim(),
      created_at: draft.created_at ?? new Date().toISOString(),
    };
    const next = draft.id ? items.map(item => item.id === entry.id ? entry : item) : [entry, ...items];
    if (!persist(next)) return;
    setDraft(entry);
    setNotice('Transcript saved in this browser.');
  }

  function remove(item) {
    if (!window.confirm('Delete “' + item.title + '”?')) return;
    if (!persist(items.filter(entry => entry.id !== item.id))) return;
    if (draft.id === item.id) setDraft({title: '', body: ''});
    setNotice('Transcript deleted.');
  }

  return <main>
    <header><span className="mark" aria-hidden="true"><i/><i/><i/><i/><i/></span><strong>Speech Desk</strong></header>
    <h1>Live transcription</h1>
    <p className="intro">Record, edit, and save conversations in Hindi or English.</p>
    <div className="layout">
      <section className="panel workspace">
        <div className="section-heading">
          <h2>Recording studio</h2>
          <span className={'record-state ' + (state === 'Recording' ? 'on-air' : '')}>{state}</span>
        </div>
        <div className="toolbar">
          <label>Recognition language<select value={language} onChange={event => setLanguage(event.target.value)} disabled={active}>
            <option value="hi-IN">Hindi (India)</option>
            <option value="en-IN">English (India)</option>
            <option value="en-US">English (US)</option>
          </select></label>
          {state === 'Recording'
            ? <button className="stop" onClick={stop}>■ Stop recording</button>
            : state === 'Opening microphone'
              ? <button onClick={() => cancel('Recording canceled.')}>Cancel</button>
              : <button className="primary" disabled={active} onClick={start}>● Start recording</button>}
        </div>
        <label>Title<input value={draft.title} maxLength={120} placeholder="Untitled transcript"
          onChange={event => setDraft({...draft, title: event.target.value})} readOnly={active}/></label>
        <div className="transcript-field">
          <label htmlFor="transcript">Transcript</label>
          <textarea id="transcript" value={draft.body} readOnly={active}
            placeholder={state === 'Recording' ? 'Listening for speech…' : 'Start recording or type here.'}
            onChange={event => setDraft({...draft, body: event.target.value})}/>
        </div>
        <div className="toolbar actions">
          <button disabled={active} onClick={() => {setDraft({title: '', body: ''}); setNotice('');}}>New transcript</button>
          <button className="primary" disabled={active || !draft.body.trim()} onClick={save}>{draft.id ? 'Save changes' : 'Save transcript'}</button>
        </div>
        {microphoneUnavailable && <div className="empty-history">
          <p>{microphoneUnavailable}</p>
          {window.isSecureContext && <button type="button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setNotice('Link copied. Paste it into a Chrome tab.');
            } catch {
              setNotice('Copy the address from your browser and open it directly in Chrome.');
            }
          }}>Copy page link</button>}
        </div>}
        <p role="status" className="notice">{notice}</p>
      </section>
      <aside className="panel">
        <div className="section-heading"><h2>History</h2><span className="record-state">{items.length} saved</span></div>
        {items.length === 0 && <div className="empty-history"><strong>No saved transcripts</strong><p>Transcripts are saved in this browser.</p></div>}
        <ul>{items.map(item => <li key={item.id} className={item.id === draft.id ? 'selected' : ''}>
          <button className="entry" disabled={active} onClick={() => {setDraft(item); setNotice('');}}>
            <strong>{item.title}</strong><span>{new Date(item.created_at).toLocaleString()}</span>
          </button>
          <button className="delete" disabled={active} onClick={() => remove(item)} aria-label={'Delete ' + item.title}>Delete</button>
        </li>)}</ul>
      </aside>
    </div>
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
