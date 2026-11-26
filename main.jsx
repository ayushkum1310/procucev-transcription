import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {record} from './recording';

function microphoneIssue() {
  if (!window.isSecureContext) return 'Microphone access needs HTTPS or localhost.';
  const policy = document.permissionsPolicy ?? document.featurePolicy;
  if (policy?.allowsFeature('microphone') === false) {
    return 'This preview blocks microphone access. Copy the page link and open it directly in Chrome.';
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.Worker) {
    return 'Microphone capture is unavailable in this browser. Open the page directly in desktop Chrome.';
  }
  return '';
}

const storageKey = 'speech-desk.transcripts.v1';
function App() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({title: '', body: ''});
  const [language, setLanguage] = useState('hindi');
  const [state, setState] = useState('Ready');
  const [notice, setNotice] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const current = useRef(null);
  const worker = useRef(null);
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
      current.current?.cancel();
      worker.current?.terminate();
    };
  }, []);

  function start() {
    if (current.current) return;
    if (microphoneUnavailable) {
      setNotice(microphoneUnavailable);
      return;
    }
    setNotice('');
    worker.current ??= new Worker(new URL('./whisper.worker.js', import.meta.url), {type: 'module'});
    current.current = record(worker.current, language, {
      onState(next) {
        if (next === 'Recording') setDraft({title: '', body: ''});
        setState(next);
      },
      onText(body) {
        setDraft(previous => ({...previous, body}));
      },
      onLevel: setMicLevel,
      onFinish(message) {
        current.current = null;
        if (message !== 'Recording complete.' && message !== 'No speech was detected.') {
          worker.current?.terminate();
          worker.current = null;
        }
        setMicLevel(0);
        setState('Ready');
        setNotice(message);
      },
    });
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
    <p className="intro">Record and edit Hindi or English speech. Audio stays in this browser.</p>
    <div className="layout">
      <section className="panel workspace">
        <div className="section-heading">
          <h2>Recording studio</h2>
          <span className={'record-state ' + (state === 'Recording' ? 'on-air' : '')}>{state}</span>
        </div>
        <div className="toolbar">
          <label>Recognition language<select value={language} onChange={event => setLanguage(event.target.value)} disabled={active}>
            <option value="hindi">Hindi / Hinglish (Latin script)</option>
            <option value="english">English</option>
          </select></label>
          {state === 'Recording'
            ? <button className="stop" onClick={() => current.current?.stop()}>■ Stop recording</button>
            : active
              ? <button onClick={() => current.current?.cancel()}>Cancel</button>
              : <button className="primary" disabled={active} onClick={start}>● Start recording</button>}
        </div>
        {state === 'Recording' && <div className="mic-monitor">
          <span>Microphone input</span><meter aria-label="Microphone input level" min="0" max="1" value={micLevel}/>
        </div>}
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
