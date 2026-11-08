import { useRef, useState } from 'react';
import { SavedLocationInput } from './EditLoadInputs.jsx';
import { emptyYardLabel, isEmptyYardMove } from '../../shared/emptyYard.js';
export default function EmptyYardReturn({ load, drivers, locations, formatAddress, apiBase, token, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [yard, setYard] = useState('');
  const [terminal, setTerminal] = useState(load.returnLocation || '');
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const moves = [...(load.moves || [])].sort((a,b) => a.sequence - b.sequence);
  const special = moves.filter(isEmptyYardMove);
  const next = moves.find(move => !['Completed', 'Cancelled'].includes(move.status));
  const eligible = load.loadType !== 'EXPORT' && moves.some(move => ['RETURN','PICKUP_RETURN'].includes(move.moveType) && ['Planned','Waiting Customer','Ready for Pickup'].includes(move.status) && !move.driverId);
  if (!special.length && !eligible) return null;
  const request = async (path, method, body, success) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch(`${apiBase}${path}`, {method, headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify(body)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save this movement.');
      await onRefresh(); setMessage(success); setOpen(false);
    } catch(error) { setMessage(error.message); }
    finally { pending.current = false; setBusy(false); }
  };
  const complete = move => {
    const atYard = ['EMPTY_YARD','PRE_PULL','DROP'].includes(move.moveType);
    const label = move.moveType === 'EMPTY_YARD' ? 'the empty container has arrived at the yard' : move.moveType === 'YARD_RETURN' ? 'the empty container has been returned to the port' : 'this movement is complete and the container is ready for the next movement';
    if (!window.confirm(`Confirm ${label}. This records the assigned driver's movement and pay.`)) return;
    request(`/api/loads/${load.id}/status`, 'PUT', {status:atYard ? 'Dropped' : 'Delivered'}, move.moveType === 'YARD_RETURN' ? 'Return completed.' : 'Movement completed. Assign the next driver when ready.');
  };
  return <section className="empty-yard-panel">
    <div className="panel-header"><div><h3>Empty container · Yard &amp; return</h3><p>Keep both movements on this load, with a separate driver and pay for each.</p></div></div>
    {!special.length && <>
      <button type="button" className="secondary-btn" disabled={busy} onClick={()=>setOpen(!open)}>Add Drop Empty at Yard</button>
      {open && <form onSubmit={event=>{event.preventDefault();request(`/api/loads/${load.id}/empty-yard`,'POST',{yard,returnLocation:terminal},'Empty yard return added.');}}>
        <fieldset disabled={busy}>
          <SavedLocationInput label="Drop empty at yard" name="yard" value={yard} options={locations} formatAddress={formatAddress} onChange={event=>setYard(event.target.value)} />
          <SavedLocationInput label="Final empty return / port" name="terminal" value={terminal} options={locations} formatAddress={formatAddress} onChange={event=>setTerminal(event.target.value)} />
          <p>The customer-to-port return becomes customer → yard → port. Complete the delivery first, then assign each movement.</p>
          <button type="submit" className="primary-btn" disabled={!yard.trim() || !terminal.trim()}>Add movements</button>{' '}
          <button type="button" className="secondary-btn" onClick={()=>setOpen(false)}>Cancel</button>
        </fieldset>
      </form>}
    </>}
    {special.length > 0 && <>
      {next && !isEmptyYardMove(next) && <div className="detail-box"><strong>Current movement: {next.moveType.replaceAll('_',' ')}</strong><span>{next.origin} → {next.destination}</span>
        <button type="button" className="secondary-btn" disabled={busy || !next.driverId || next.status === 'Waiting Customer'} onClick={()=>complete(next)}>Complete current movement</button></div>}
      <div className="empty-yard-steps">{special.map((move,index)=>{
        const draft = drafts[move.id] || {};
        const patch = (key,value)=>setDrafts(prev=>({...prev,[move.id]:{...prev[move.id],[key]:value}}));
        const current = next?.id === move.id;
        return <div className="detail-box" key={move.id}>
          <h4>{index+1}. {emptyYardLabel(move.moveType)}</h4><p>{move.origin} → {move.destination}</p><strong>{move.status}</strong>
          {move.driverId && <p>{drivers.find(driver=>driver.id===move.driverId)?.name || move.driverId} · Driver Pay: ${move.driverRate || '0.00'}</p>}
          {move.completedAt && <p>Completed: {new Date(move.completedAt).toLocaleString()}</p>}
          {current && move.status === 'Planned' && <form onSubmit={event=>{event.preventDefault();request(`/api/load-moves/${move.id}/assign`,'PUT',draft,'Driver assigned.');}}><fieldset disabled={busy}>
            <label>Driver (same or different)<select required aria-label={`Driver for ${emptyYardLabel(move.moveType)}`} value={draft.driverId || ''} onChange={event=>patch('driverId',event.target.value)}><option value="">Choose driver</option>{drivers.filter(driver=>driver.isActive !== false && driver.isActive !== 0).map(driver=><option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label>
            <label>Driver Pay<input required type="number" min="0" step="0.01" aria-label={`Driver Pay for ${emptyYardLabel(move.moveType)}`} value={draft.driverRate ?? ''} onChange={event=>patch('driverRate',event.target.value)} /></label>
            <button type="submit" className="primary-btn">Assign movement</button>
          </fieldset></form>}
          {!current && move.status === 'Planned' && <p>Waiting for the previous movement to finish.</p>}
          {current && move.driverId && <button type="button" className="primary-btn" disabled={busy} onClick={()=>complete(move)}>{move.moveType === 'EMPTY_YARD' ? 'Confirm Empty at Yard' : 'Complete Return at Port'}</button>}
        </div>;
      })}</div>
    </>}
    <p role="status" aria-live="polite">{busy ? 'Saving movement…' : message}</p>
  </section>;
}
