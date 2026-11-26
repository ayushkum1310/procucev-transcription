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

async function transcripts(path = '', method = 'GET', data) {
  const response = await fetch('/api/transcripts' + path, {
    method,
    ...(data && {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}),
  });
  if (!response.ok) throw new Error('The transcript service could not complete this request.');
  return response.status === 204 ? undefined : response.json();
}

function App() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({title: '', body: ''});
  const [language, setLanguage] = useState('hindi');
  const [state, setState] = useState('Ready');
  const [notice, setNotice] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const current = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = state !== 'Ready';
  const microphoneUnavailable = microphoneIssue();

  async function refresh() {
    try {
      setItems(await transcripts());
      setLoaded(true);
    } catch (error) {
      setNotice(error.message);
    }
  }

  useEffect(() => {
    refresh();
    return () => current.current?.cancel();
  }, []);

  function start() {
    if (current.current || !loaded || busy) return;
    if (microphoneUnavailable) {
      setNotice(microphoneUnavailable);
      return;
    }
    setNotice('');
    current.current = record(language, {
      onState(next) {
        if (next === 'Recording') setDraft({title: '', body: ''});
        setState(next);
      },
      onText(text) {
        setDraft(previous => ({...previous, body: [previous.body, text].filter(Boolean).join(' ')}));
      },
      onLevel: setMicLevel,
      onFinish(message) {
        current.current = null;
        setMicLevel(0);
        setState('Ready');
        setNotice(message);
      },
    });
  }

  async function save() {
    setBusy(true);
    const entry = {title: draft.title.trim() || draft.body.trim().slice(0, 60), body: draft.body.trim()};
    try {
      const {id} = draft.id
        ? await transcripts('/' + draft.id, 'PUT', entry)
        : await transcripts('', 'POST', entry);
      setDraft({...entry, id});
      await refresh();
      setNotice('Transcript saved.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item) {
    if (!window.confirm('Delete “' + item.title + '”?')) return;
    setBusy(true);
    try {
      await transcripts('/' + item.id, 'DELETE');
      if (draft.id === item.id) setDraft({title: '', body: ''});
      await refresh();
      setNotice('Transcript deleted.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <main>
    <header><span className="mark" aria-hidden="true"><i/><i/><i/><i/><i/></span><strong>Speech Desk</strong></header>
    <h1>Live transcription</h1>
    <p className="intro">Record and edit Hindi or English speech. Text is added after a short pause.</p>
    <div className="layout">
      <section className="panel workspace">
        <div className="section-heading">
          <h2>Recording studio</h2>
          <span className={'record-state ' + (state === 'Recording' ? 'on-air' : '')}>{state}</span>
        </div>
        <div className="toolbar">
          <label>Recognition language<select value={language} onChange={event => setLanguage(event.target.value)} disabled={active}>
            <option value="hindi">Hindi + English</option>
            <option value="english">English</option>
          </select></label>
          {state === 'Recording'
            ? <button className="stop" onClick={() => current.current?.stop()}>■ Stop recording</button>
            : active
              ? <button onClick={() => current.current?.cancel()}>Cancel</button>
              : <button className="primary" disabled={active || busy || !loaded} onClick={start}>● Start recording</button>}
        </div>
        {state === 'Recording' && <div className="mic-monitor">
          <span>Microphone input</span><meter aria-label="Microphone input level" min="0" max="1" value={micLevel}/>
        </div>}
        <label>Title<input value={draft.title} maxLength={120} placeholder="Untitled transcript"
          onChange={event => setDraft({...draft, title: event.target.value})} readOnly={active || busy}/></label>
        <div className="transcript-field">
          <label htmlFor="transcript">Transcript</label>
          <textarea id="transcript" value={draft.body} readOnly={active || busy}
            placeholder={state === 'Recording' ? 'Listening for speech…' : 'Start recording or type here.'}
            onChange={event => setDraft({...draft, body: event.target.value})}/>
        </div>
        <div className="toolbar actions">
          <button disabled={active || busy} onClick={() => {setDraft({title: '', body: ''}); setNotice('');}}>New transcript</button>
          <button className="primary" disabled={active || busy || !loaded || !draft.body.trim()} onClick={save}>{draft.id ? 'Save changes' : 'Save transcript'}</button>
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
        {!loaded && <button onClick={refresh}>Retry loading history</button>}
        {loaded && items.length === 0 && <div className="empty-history"><strong>No saved transcripts</strong><p>Saved transcripts will appear here.</p></div>}
        <ul>{items.map(item => <li key={item.id} className={item.id === draft.id ? 'selected' : ''}>
          <button className="entry" disabled={active || busy} onClick={() => {setDraft(item); setNotice('');}}>
            <strong>{item.title}</strong><span>{new Date(item.created_at).toLocaleString()}</span>
          </button>
          <button className="delete" disabled={active || busy} onClick={() => remove(item)} aria-label={'Delete ' + item.title}>Delete</button>
        </li>)}</ul>
      </aside>
    </div>
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
