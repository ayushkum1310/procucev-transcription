import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

async function api(path = '', method = 'GET', data) {
  const response = await fetch('/api/transcripts' + path, {
    method,
    ...(data && {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}),
  });
  if (!response.ok) throw new Error('Could not ' + ({GET:'load history', POST:'save', PUT:'update', DELETE:'delete'}[method]) + '.');
  return response.status === 204 ? null : response.json();
}

function App() {
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(null);
  const [lang, setLang] = useState('auto');
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState('');
  const session = useRef(null);

  async function refresh() {
    setHistory(await api());
    setLoaded(true);
  }
  useEffect(() => { refresh().catch(error => setNotice(error.message)); }, []);

  useEffect(() => {
    if (status !== 'recording') return;
    const started = performance.now();
    const ticker = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 250);
    return () => clearInterval(ticker);
  }, [status]);

  function release(recording) {
    recording.stream?.getTracks().forEach(track => track.stop());
    recording.context?.close().catch(() => {});
  }
  function finish(recording, message) {
    if (session.current !== recording) return;
    session.current = null;
    release(recording);
    recording.socket?.close();
    setStatus('idle');
    if (message) setNotice(message);
  }

  async function start() {
    setNotice('');
    setStatus('connecting');
    const recording = {};
    session.current = recording;
    try {
      recording.stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true}, video: false});
      recording.context = new AudioContext({sampleRate: 16000});
      if (recording.context.sampleRate !== 16000) throw new Error('This device could not start 16 kHz audio.');
      await recording.context.audioWorklet.addModule('/pcm.js');
      const url = new URL('/ws/transcribe', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('lang', lang);
      const socket = recording.socket = new WebSocket(url);
      socket.onclose = () => finish(recording, 'The transcription connection closed.');
      socket.onmessage = async event => {
        if (session.current !== recording) return;
        const message = JSON.parse(event.data);
        if (message.error) return finish(recording, message.error);
        if (typeof message.text === 'string') setBody(message.text);
        if (message.done) {
          finish(recording);
          setNotice(message.text ? 'Recording complete.' : 'No speech detected. Try speaking closer to the microphone.');
        }
        if (message.ready) {
          try {
            const context = recording.context;
            await context.resume();
            if (session.current !== recording) return;
            const node = recording.node = new AudioWorkletNode(context, 'pcm');
            node.port.onmessage = ({data}) => {
              if (socket.readyState !== WebSocket.OPEN) return;
              if (data === 'flushed') socket.send('stop');
              else if (socket.bufferedAmount > 512000) finish(recording, 'Connection too slow. You can save the text already shown.');
              else socket.send(data);
            };
            context.createMediaStreamSource(recording.stream).connect(node);
            node.connect(context.destination);
            setEditing(null);
            setTitle('');
            setBody('');
            setElapsed(0);
            setStatus('recording');
          } catch (error) {
            finish(recording, error.message);
          }
        }
      };
    } catch (error) {
      finish(recording, error.message || 'Microphone access failed.');
    }
  }

  function stop() {
    setStatus('finishing');
    session.current.node.port.postMessage('flush');
    session.current.stream.getTracks().forEach(track => track.stop());
  }

  function open(item) {
    setEditing(item?.id ?? null);
    setTitle(item?.title ?? '');
    setBody(item?.body ?? '');
    setNotice('');
  }

  async function save() {
    setBusy(true);
    try {
      const result = await api(editing ? '/' + editing : '', editing ? 'PUT' : 'POST', {
        title: title.trim() || body.trim().slice(0, 60),
        body: body.trim(),
      });
      setEditing(result.id);
      await refresh();
      setNotice('Transcript saved.');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  async function remove(item) {
    if (!window.confirm('Delete “' + item.title + '”?')) return;
    setBusy(true);
    try {
      await api('/' + item.id, 'DELETE');
      if (editing === item.id) open(null);
      await refresh();
      setNotice('Transcript deleted.');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  const active = status !== 'idle';
  const time = Math.floor(elapsed / 60) + ':' + String(elapsed % 60).padStart(2, '0');
  return <main>
    <header><span className="mark" aria-hidden="true">▥</span><strong>Speech Desk</strong></header>
    <h1>Live transcription</h1>
    <p className="intro">Speak in Hindi, English, or a mix of both. Review and save the result.</p>
    <div className="layout">
      <section className="panel workspace">
        <div className="section-heading">
          <h2>Recording studio</h2>
          <span className={'record-state ' + (status === 'recording' ? 'on-air' : '')}>
            {status === 'recording' ? 'Recording · ' + time : status === 'connecting' ? 'Preparing model' : status === 'finishing' ? 'Refining transcript' : editing ? 'Saved transcript' : 'Ready'}
          </span>
        </div>
        <div className="toolbar">
          <label>Recognition language<select value={lang} onChange={e => setLang(e.target.value)} disabled={active}>
            <option value="auto">Hindi + English / Auto</option><option value="hi">Hindi-first</option><option value="en">English</option>
          </select></label>
          {status === 'recording'
            ? <button className="stop" onClick={stop}>■ Stop recording</button>
            : <button className="primary" disabled={active || busy || !loaded} onClick={start}>
                {status === 'connecting' ? 'Starting Whisper…' : status === 'finishing' ? 'Finishing…' : '● Start recording'}
              </button>}
        </div>
        <label>Title<input placeholder="Untitled transcript" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} readOnly={active || busy}/></label>
        <div className="transcript-field"><label htmlFor="transcript">Transcript {status === 'recording' && <span aria-hidden="true" className="preview">Live draft</span>}</label><textarea id="transcript" placeholder="Your words will appear here as you speak." value={body} maxLength={50000} onChange={e => setBody(e.target.value)} readOnly={active || busy}/></div>
        <div className="toolbar actions"><button disabled={active || busy} onClick={() => open(null)}>New transcript</button>
          <button className="primary" disabled={active || busy || !loaded || !body.trim()} onClick={save}>{editing ? 'Save changes' : 'Save transcript'}</button></div>
        <p role="status" className="notice">{notice || (status === 'recording' ? 'Recording · Speak naturally' : '')}</p>
      </section>
      <aside className="panel"><div className="section-heading"><h2>History</h2>{loaded && <span className="record-state">{history.length} saved</span>}</div>
        {!loaded && <button onClick={() => refresh().catch(error => setNotice(error.message))}>Retry loading history</button>}
        {loaded && history.length === 0 && <p>No saved transcripts yet.</p>}
        <ul>{history.map(item => <li key={item.id} className={editing === item.id ? 'selected' : ''}>
          <button className="entry" disabled={active || busy} onClick={() => open(item)}><strong>{item.title}</strong>
          <span>{new Date(item.created_at).toLocaleString()}</span></button>
          <button className="delete" disabled={active || busy} onClick={() => remove(item)} aria-label={'Delete ' + item.title}>Delete</button>
        </li>)}</ul>
      </aside>
    </div>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
