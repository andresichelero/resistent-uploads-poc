import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Transfers, api, type Transfer } from './transfers';
import './style.css';

const transfers = new Transfers();
const bytes = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024 / 1024).toFixed(1)} MiB`;
const labels = { hashing: 'Reading file', uploading: 'Uploading', paused: 'Paused', waiting: 'Waiting for connection', reselect: 'Select original to resume', verifying: 'Verifying', done: 'Ready to download', error: 'Needs attention', deleting: 'Deleting' };
function TransferRow({ item }: { item: Transfer }) {
  const input = useRef<HTMLInputElement>(null);
  const percent = item.size ? Math.min(100, item.sent / item.size * 100) : item.phase === 'done' ? 100 : 0;
  const confirmed = item.size ? item.confirmed / item.size * 100 : percent;
  const estimate = item.rate.estimate(item.size);
  const record = item.record;
  const scanLabel = record?.scan === 'clean' ? 'No malware detected' : record?.scan === 'not_run' ? 'Antivirus not run' : record?.scan === 'detected' ? 'Malware detected · blocked' : record?.scan === 'inconclusive' ? 'Scan inconclusive · blocked' : record?.scan === 'error' ? 'Scanner unavailable · blocked' : 'Scan pending';
  return <article className="transfer" aria-label={item.name}>
    <div className="file-heading"><span className="file-icon" aria-hidden="true">↥</span><div className="file-name"><h3>{item.name}</h3><p>{bytes(item.size)} <span className="dot">•</span> {labels[item.phase]}</p></div><span className={`status status-${item.phase}`}>{item.phase === 'done' ? 'Verified' : item.phase === 'paused' ? 'Paused' : item.phase === 'uploading' ? `${Math.floor(percent)}%` : labels[item.phase]}</span></div>
    <div className="track" role="progressbar" aria-label={`Upload ${item.name}`} aria-valuenow={Math.floor(confirmed)} aria-valuemin={0} aria-valuemax={100}>
      <div className="sent" style={{ width: `${item.phase === 'hashing' ? item.hashProgress / Math.max(1, item.size) * 100 : percent}%` }}/><div className="confirmed" style={{ width: `${confirmed}%` }}/>
    </div>
    <div className="progress-note"><span>{bytes(item.confirmed)} confirmed</span><span>{item.phase === 'uploading' ? estimate.seconds === null ? 'Estimating transfer time…' : `${bytes(estimate.bytesPerSecond)}/s · about ${estimate.seconds}s left` : item.phase === 'paused' ? 'Your confirmed bytes stay here.' : item.phase === 'verifying' ? 'Transfer finished. Checking the stored file…' : item.phase === 'reselect' ? 'Your browser needs access to the file again.' : ''}</span></div>
    {item.message && <p className="notice" role="status">{item.message}</p>}
    {record?.detail && item.phase === 'error' && <p className="notice">{record.detail}</p>}
    {record && <div className="checks"><span className={record.integrity === 'verified' ? 'check-pass' : ''}>{record.integrity === 'verified' ? '✓ Integrity verified' : `Integrity: ${record.integrity}`}</span><span className={record.scan === 'clean' ? 'check-pass' : ''}>{scanLabel}</span></div>}
    <div className="actions">
      {item.phase === 'uploading' && <button onClick={() => void transfers.pause(item.id)}>Pause</button>}
      {['paused', 'waiting', 'error'].includes(item.phase) && (!record || record.integrity === 'pending') && <button className="primary" onClick={() => transfers.start(item.id)}>Resume</button>}
      {item.phase === 'reselect' && <button className="primary" onClick={() => input.current?.click()}>Select original file</button>}
      <input ref={input} aria-label={`Reselect ${item.name}`} type="file" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void transfers.reselect(item.id, file); e.target.value = ''; }}/>
      {record?.downloadable && <button className="primary" disabled={item.download?.state === 'Downloading'} onClick={() => void transfers.download(item.id)}>Download & verify</button>}
      {item.phase === 'error' && record?.offset === record?.size && record && <button onClick={() => void transfers.verify(item.id)}>Retry verification</button>}
      <button className="quiet" disabled={item.phase === 'deleting'} onClick={() => void transfers.remove(item.id)}>{record?.downloadable ? 'Delete' : 'Cancel'}</button>
      <details><summary>Transfer details</summary><div className="details-body"><dl><dt>Confirmed offset</dt><dd>{item.confirmed.toLocaleString()} bytes</dd><dt>Retry attempts</dt><dd>{item.retries}</dd><dt>Original SHA-256</dt><dd className="hash">{record?.sha256 || 'Reading…'}</dd><dt>Stored SHA-256</dt><dd className="hash">{record?.actualSha256 || 'Pending'}</dd><dt>Scanner version / signatures</dt><dd>{record?.scannerVersion || 'Not available'}</dd></dl><ol className="events">{item.events.map((event, i) => <li key={i}>{event}</li>)}</ol></div></details>
    </div>
    {item.download && <div className="download-state" role="status">{item.download.state} — {bytes(item.download.bytes)}{item.download.state === 'Downloading' && <> · {item.download.rate.estimate(item.size).seconds === null ? 'estimating…' : `about ${item.download.rate.estimate(item.size).seconds}s left`}</>}</div>}
  </article>;
}
function App() {
  const items = useSyncExternalStore(transfers.subscribe, transfers.snapshot);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [health, setHealth] = useState<{ scanRequired: boolean }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const refresh = async () => { try { const h = await api<{ scanRequired: boolean }>('/api/health'); await transfers.refresh(); if (live) { setHealth(h); setError(''); } } catch { if (live) setError('Local services are unavailable. Your transfer records are preserved; reconnect to continue.'); } };
    void refresh(); const timer = setInterval(() => void refresh(), 1000);
    window.addEventListener('online', transfers.online);
    return () => { live = false; clearInterval(timer); window.removeEventListener('online', transfers.online); };
  }, []);
  const add = (files: FileList | File[]) => { for (const file of Array.from(files)) void transfers.add(file); };
  const completed = items.filter(r => r.phase === 'done').length;
  return <><header className="topbar"><a className="brand" href="/" aria-label="Resume Proof home"><span className="brand-mark" aria-hidden="true">↥</span>Resume Proof</a><span className="local-badge"><span/>Local workbench</span><a className="source-link" href="https://github.com/andresichelero/resistent-uploads-poc" target="_blank" rel="noreferrer">Source code ↗</a></header>
    <main><section className="intro"><div><h1>A connection can drop.<br/>Your progress can stay.</h1><p>Pause a transfer. Lose the connection. Come back and finish.<br className="desktop-break"/> Every completed file is checked against the original.</p></div><div className="intro-note"><span className="loop-icon" aria-hidden="true">↻</span><p>Pick up from<br/><strong>confirmed bytes.</strong></p></div></section>
      {error && <div className="service-error" role="alert">{error}</div>}
      <div className="workspace"><section className="upload-workspace" aria-labelledby="transfers-heading"><div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}><div className="drop-icon" aria-hidden="true">↥</div><h2>Give your files a reliable way up.</h2><p>Drop files here, or choose them from your device.</p><button className="primary choose" onClick={() => fileInput.current?.click()}>Choose files</button><input ref={fileInput} type="file" multiple hidden aria-label="Choose files" onChange={e => { if (e.target.files) add(e.target.files); e.target.value = ''; }}/><small>100 MiB per file · Multiple transfers · Files expire after 24 hours</small></div>
        <div className="list-heading"><h2 id="transfers-heading">Your transfers <span>{items.length}</span></h2><p>{completed ? `${completed} verified` : 'Ready when you are'}</p></div>
        {items.length ? <div>{items.map(item => <TransferRow key={item.id} item={item}/>)}</div> : <div className="empty"><span aria-hidden="true">⇅</span><div><h3>No transfers yet</h3><p>Add a file to see its progress, recovery and verification here.</p></div></div>}
      </section><aside><section className="how-it-works"><h2>Try interrupting it.</h2><p>A small experiment, with a result you can check.</p><ol><li><strong>Start a transfer</strong><span>Choose a file. Several can upload at the same time.</span></li><li><strong>Pause. Then continue.</strong><span>Or switch your browser offline for a real connection failure.</span></li><li><strong>Check the result</strong><span>Compare the original and stored hashes in Transfer details.</span></li></ol><div className="legend"><span><i className="legend-sent"/>Sent by your browser</span><span><i className="legend-confirmed"/>Confirmed by the server</span></div></section>
        <section className="safety-note"><span className="shield" aria-hidden="true">◇</span><h2>{health?.scanRequired ? 'Antivirus mode' : 'Integrity mode'}</h2><p>{health?.scanRequired ? 'Downloads stay blocked until integrity and malware checks pass. An inconclusive scan stays blocked.' : 'SHA-256 checks that the stored file matches. Antivirus is not run in this mode.'}</p><p className="small">After reloading, select the original file to resume. File content is checked before continuing.</p></section>
      </aside></div>
      <footer><p>Built to make recovery observable.</p><p>Local demo · No account · No third-party file analysis</p></footer>
    </main></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
