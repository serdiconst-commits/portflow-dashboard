import { useRef,useState } from 'react';
import { perDiemTracking } from '../../shared/perDiem.js';
export const PER_DIEM_LABELS={overdue:'Overdue',today:'Due today',soon:'Due next workday',upcoming:'Upcoming',returned:'Returned', 'needs-calendar':'Holiday calendar needed'};
export function PerDiemBadge({load,today,calendar}) {
 const state=perDiemTracking(load,today,calendar);
 return <div className={`per-diem-badge ${state.status || ''}`}><strong>{state.deadline || '—'}</strong><small>{PER_DIEM_LABELS[state.status] || 'Departure date needed'}</small></div>;
}
export function PerDiemPanel({load,today,calendar,apiBase,token,onSaved,canEdit=true}) {
 const binding=!load.perDiemContainerNumber || String(load.perDiemContainerNumber).trim().toUpperCase()===String(load.containerNumber || '').trim().toUpperCase();
 const [open,setOpen]=useState(false);
 const [out,setOut]=useState(binding?load.perDiemPortOutDate || '':'');
 const [due,setDue]=useState(binding?load.perDiemDueDate || '':'');
 const [returned,setReturned]=useState(binding?load.perDiemReturnedDate || '':'');
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const pending=useRef(false);
 if(load.loadType==='EXPORT' || !load.containerNumber)return null;
 const preview=perDiemTracking({...load,perDiemContainerNumber:load.containerNumber,perDiemPortOutDate:out,perDiemDueDate:due,perDiemReturnedDate:returned},today,calendar);
 return <section className="per-diem-panel"><div className="documents-header"><div><h4>Per Diem · Last Return Day</h4><PerDiemBadge load={load} today={today} calendar={calendar}/></div>{canEdit && <button type="button" className="secondary-btn" onClick={()=>{setOut(binding?load.perDiemPortOutDate || '':'');setDue(binding?load.perDiemDueDate || '':'');setReturned(binding?load.perDiemReturnedDate || '':'');setMessage('');setOpen(!open);}}>Edit return dates</button>}</div>
 <p>4 business days, counting departure as day 1. Weekends and listed holidays are excluded.</p>
 {load.perDiemOutSource && binding && <small>Departure source: {load.perDiemOutSource}</small>}
 {open && <form onSubmit={async event=>{event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setMessage('');try{
  const response=await fetch(`${apiBase}/api/loads/${load.id}/per-diem`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({portOutDate:out,dueDate:due,returnedDate:returned})});
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'Unable to save return dates.');onSaved(data);setOpen(false);setMessage('Return dates saved.');
 }catch(error){setMessage(error.message);}finally{setBusy(false);pending.current=false;}}}>
 <fieldset disabled={busy}>
  <label>Port departure date<input type="date" aria-label="Port departure date" max={today} value={out} onChange={event=>setOut(event.target.value)}/></label>
  <div className="detail-box"><span>Last return day</span><strong>{preview.deadline || '—'}</strong><small>{preview.error || PER_DIEM_LABELS[preview.status] || 'Enter the departure date.'}</small></div>
  <label>Confirmed last return day (optional override)<input type="date" aria-label="Confirmed last return day" min={out || undefined} value={due} onChange={event=>setDue(event.target.value)}/></label>
  <label>Actual return at port (optional)<input type="date" aria-label="Actual return at port" max={today} min={out || undefined} value={returned} onChange={event=>setReturned(event.target.value)}/></label>
  <small>Customer delivery and yard drops do not count as the final port return.</small>
  <button type="submit" className="primary-btn">{busy?'Saving…':'Save return dates'}</button>
 </fieldset></form>}
 <p role="status">{message}</p></section>;
}
export function PerDiemFilters({filter,setFilter,calendar,setCalendar,apiBase,token}) {
 const [open,setOpen]=useState(false);const [year,setYear]=useState(String(new Date().getFullYear()));const [dates,setDates]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 return <section className="per-diem-panel"><div className="documents-header"><div><h3>Per Diem · Container return deadlines</h3><p>Pending port returns remain here even after customer delivery.</p></div><select aria-label="Per Diem filter" value={filter} onChange={event=>setFilter(event.target.value)}>
 {Object.entries({attention:'Needs attention',all:'All pending returns',overdue:'Overdue',today:'Due today',soon:'Due next workday',upcoming:'Upcoming','needs-calendar':'Holiday calendar needed'}).map(([value,label])=><option key={value} value={value}>{label}</option>)}
 </select><button type="button" className="secondary-btn" onClick={()=>{setDates((calendar[year] || []).join('\n'));setOpen(!open);}}>Holiday calendar</button></div>
 {open && <form onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);setMessage('');try{
  const response=await fetch(`${apiBase}/api/per-diem/calendar`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({year,dates:dates.split(/[\s,]+/).filter(Boolean)})});const data=await response.json();if(!response.ok)throw new Error(data.error || 'Unable to save calendar.');setCalendar(data);setMessage('Holiday calendar saved.');
 }catch(error){setMessage(error.message);}finally{setBusy(false);}}}>
 <fieldset disabled={busy}><label>Calendar year<input type="number" min="2000" max="2099" value={year} onChange={event=>{setYear(event.target.value);setDates((calendar[event.target.value] || []).join('\n'));}}/></label>
 <label>Excluded holidays (YYYY-MM-DD, one per line)<textarea aria-label="Excluded holidays" value={dates} onChange={event=>setDates(event.target.value)} rows="8"/></label>
 <small>The 2026 defaults include all holidays listed by Port Houston, including reduced-hours holidays. Add a calendar for each new year before automatic calculation.</small>
 <a href="https://porthouston.com/toolbox/terminals/hours-and-schedules/" target="_blank" rel="noreferrer">Port Houston holiday schedule</a>
 <button type="submit" className="primary-btn">Save calendar</button></fieldset></form>}
 <p role="status">{message}</p></section>;
}
