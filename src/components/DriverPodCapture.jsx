import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './DriverPodCapture.css';

function SignaturePad({ value, onChange, disabled }) {
  const drawing = useRef(false);
  const strokes = useRef(value);
  useEffect(() => { strokes.current = value; }, [value]);
  const point = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {x: Math.max(0, Math.min(1, (e.clientX-rect.left)/rect.width)), y: Math.max(0, Math.min(1, (e.clientY-rect.top)/rect.height))};
  };
  return <div className="pod-signature-wrap">
    <svg viewBox="0 0 600 220" preserveAspectRatio="none" role="img" aria-label="Receiver signature pad. Draw with a finger, stylus, or mouse."
      className={`pod-signature-pad${disabled ? ' locked' : ''}`}
      onPointerDown={e => { if (disabled || e.button > 0) return; e.preventDefault(); drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const next = [...strokes.current, [point(e)]]; strokes.current = next; onChange(next); }}
      onPointerMove={e => { if (!drawing.current || disabled) return; const next = strokes.current.map((s,i) => i === strokes.current.length-1 ? [...s,point(e)] : s); strokes.current = next; onChange(next); }}
      onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }}>
      <line x1="28" x2="572" y1="182" y2="182" stroke="#d4dfe6" strokeDasharray="5 5" />
      {value.map((s,i) => <polyline key={i} points={s.map(p => `${p.x*600},${p.y*220}`).join(' ')} fill="none" stroke="#163048" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
    {!value.length && <span className="pod-signature-placeholder">Sign here</span>}
  </div>;
}

const blankDraft = () => ({requestId: crypto.randomUUID(), receiverName:'', notes:'', signature:[], signedAt:'', locked:false});

export default function DriverPodCapture({ load, actorKey, apiBase, authToken, onSaved, onClose }) {
  const storageKey = `portflow:receiver-pod:${actorKey}:${load.id}`;
  const [draft,setDraft] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(storageKey)); return saved?.requestId ? saved : blankDraft(); } catch { return blankDraft(); } });
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [storageError,setStorageError] = useState(false);
  const [online,setOnline] = useState(navigator.onLine);
  const [emailOpen,setEmailOpen] = useState(false);
  const [recipient,setRecipient] = useState('');
  const [emailStatus,setEmailStatus] = useState('');
  const [options,setOptions] = useState(null);
  const [preview,setPreview] = useState('');
  const dialog = useRef(null);
  const actionRunning = useRef(false);
  const draftRef = useRef(draft);
  const endpoint = `${apiBase}/api/driver-pods/${encodeURIComponent(load.id)}`;
  const saved = draft.saved;
  const persist = next => {
    try { localStorage.setItem(storageKey,JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  };
  const update = values => { const next = {...draftRef.current,...values}; draftRef.current = next; setDraft(next); persist(next); };
  useEffect(() => {
    dialog.current.showModal();
    const toggle = () => setOnline(navigator.onLine);
    window.addEventListener('online',toggle); window.addEventListener('offline',toggle);
    return () => { window.removeEventListener('online',toggle); window.removeEventListener('offline',toggle); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}/options`,{headers:{Authorization:`Bearer ${authToken}`},signal:controller.signal})
      .then(async r => { if (r.ok) setOptions(await r.json()); }).catch(() => {});
    return () => controller.abort();
  }, [endpoint,authToken]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const request = async (url,body) => {
    const response = await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${authToken}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed. Please retry.'), {status:response.status});
    return data;
  };
  const save = async e => {
    e.preventDefault();
    if (actionRunning.current) return;
    if (!online) { setError('No connection. Your signature is kept on this device. Retry when you are online.'); return; }
    if (!draft.receiverName.trim() || draft.signature.flat().length < 3) { setError('Enter the receiver name and collect their signature.'); return; }
    const submitted = {...draft,locked:true,signedAt:draft.signedAt || new Date().toISOString()};
    update(submitted); actionRunning.current = true; setBusy('save'); setError('');
    try {
      const data = await request(endpoint,submitted);
      update({saved:data,signature:[],notes:'',locked:true});
      onSaved(data.document);
    } catch(e) { if (e.status === 400) update({locked:false}); setError(e.name === 'TimeoutError' || e.name === 'TypeError' ? 'Upload not confirmed. Your signature is kept. Tap Retry upload when connected.' : e.message); }
    finally { actionRunning.current = false; setBusy(''); }
  };
  const send = async e => {
    e.preventDefault(); if (actionRunning.current) return;
    actionRunning.current = true; setBusy('email'); setEmailStatus(''); setError('');
    try {
      const data = await request(`${endpoint}/${saved.podId}/email`,{recipient});
      setEmailStatus(`Email accepted for sending to ${data.recipient}.`);
    } catch(e) { setError(e.name === 'TypeError' || e.name === 'TimeoutError' ? 'Email not confirmed. Your POD is saved. Retry with the same address.' : e.message); }
    finally { actionRunning.current = false; setBusy(''); }
  };
  const view = async () => {
    if (actionRunning.current) return;
    actionRunning.current = true; setBusy('preview'); setError('');
    try {
      const r = await fetch(`${endpoint}/${saved.podId}/file`,{headers:{Authorization:`Bearer ${authToken}`},signal:AbortSignal.timeout(30000)});
      if (!r.ok) throw new Error('Could not open the saved POD. Please retry.');
      setPreview(URL.createObjectURL(await r.blob()));
    } catch(e) { setError(e.message); }
    finally { actionRunning.current = false; setBusy(''); }
  };
  return createPortal(<dialog ref={dialog} className="driver-pod-dialog" aria-labelledby="driver-pod-title" onCancel={e => {e.preventDefault(); if (!busy) onClose();}}>
    <div className="pod-modal-header"><div><span className="pod-eyebrow">PORTFLOW · DELIVERY</span><h2 id="driver-pod-title">{saved ? 'POD saved' : 'Proof of delivery'}</h2></div><button type="button" className="pod-close" aria-label="Close POD" disabled={Boolean(busy)} onClick={onClose}>×</button></div>
    <div className="pod-modal-body">
      <div className="pod-load-summary"><div><span>LOAD #</span><strong>{load.id}</strong></div><div><span>CONTAINER</span><strong>{load.containerNumber || '—'}</strong></div><div className="pod-summary-wide"><span>DELIVER TO</span><strong>{load.customer || 'Customer'}</strong><p>{load.deliveryLocationName || ''}{load.deliveryLocationName ? ' · ' : ''}{load.delivery || 'Delivery location not provided'}</p></div></div>
      {storageError && <p className="pod-notice" role="alert">Device storage is unavailable. Keep this screen open until the POD is saved.</p>}
      {!online && <p className="pod-notice" role="status">Offline · {saved ? 'POD already saved. Email needs a connection.' : 'You can collect the signature and retry uploading when connected.'}</p>}
      {error && <p className="pod-error" role="alert">{error}</p>}
      {saved ? <>
        <div className="pod-success"><span aria-hidden="true">✓</span><h3>Signed. Saved. Attached.</h3><p>Your POD is attached to Load # {load.id} and available to dispatch.</p></div>
        <div className="pod-success-actions"><button type="button" disabled={Boolean(busy)} onClick={view}>{busy === 'preview' ? 'Opening…' : 'View POD'}</button><button type="button" disabled={Boolean(busy)} onClick={() => setEmailOpen(v => !v)}>Email POD <small>Optional</small></button></div>
        {preview && <div className="pod-preview"><a href={preview} download={saved.document.name}>Download signed POD</a><iframe title="Signed proof of delivery" src={preview} /></div>}
        {emailOpen && <form className="pod-email-form" onSubmit={send}><h3>Send a copy</h3><p>Choose the customer’s email or enter the receiver’s address.</p>{options?.customerEmail && <button type="button" className="pod-customer-email" onClick={() => setRecipient(options.customerEmail)}>Use customer email · {options.customerEmail}</button>}<label>Recipient email<input type="email" required maxLength={254} autoComplete="email" inputMode="email" value={recipient} onChange={e => setRecipient(e.target.value)} disabled={Boolean(busy)} placeholder="receiver@company.com" /></label>{options?.emailAvailable === false && <p className="pod-notice">Email is not configured yet. Dispatch can access the saved POD.</p>}<button className="pod-primary" type="submit" disabled={Boolean(busy) || !online || options?.emailAvailable === false}>{busy === 'email' ? 'Sending…' : 'Send POD'}</button>{emailStatus && <p className="pod-email-status" role="status">{emailStatus}</p>}</form>}
        <button type="button" className="pod-primary pod-done" disabled={Boolean(busy)} onClick={onClose}>Done</button>
      </> : <form onSubmit={save}>
        <div className="pod-step"><span>1</span><div><h3>Confirm receipt</h3><p>Ask the receiver to review the delivery and sign below.</p></div></div>
        <label className="pod-label">Receiver name<input autoComplete="off" required maxLength={100} value={draft.receiverName} disabled={draft.locked || Boolean(busy)} onChange={e => update({receiverName:e.target.value})} placeholder="Full name of the person receiving" /></label>
        <label className="pod-label">Delivery notes <span className="pod-optional">Optional</span><textarea maxLength={600} rows={2} value={draft.notes} disabled={draft.locked || Boolean(busy)} onChange={e => update({notes:e.target.value})} placeholder="Exceptions, condition, or receiving notes" /></label>
        <div className="pod-step"><span>2</span><div><h3>Receiver signature</h3><p>Sign with a finger or stylus.</p></div><button type="button" className="pod-clear" disabled={draft.locked || Boolean(busy)} onClick={() => update({signature:[],signedAt:''})}>Clear</button></div>
        <SignaturePad value={draft.signature} disabled={draft.locked || Boolean(busy)} onChange={signature => update({signature,signedAt:new Date().toISOString()})} />
        <p className="pod-consent">The signature confirms receipt of this delivery with any exceptions noted above.</p>
        <button type="submit" className="pod-primary" disabled={Boolean(busy)}>{busy === 'save' ? 'Saving signed POD…' : draft.locked ? 'Retry upload' : 'Save signed POD'}</button>
        <p className="pod-save-hint">{draft.locked ? 'Signature preserved. Retrying will not create a duplicate.' : 'Generates a PDF and attaches it to this load. Email is optional afterward.'}</p>
      </form>}
    </div>
  </dialog>,document.body);
}
