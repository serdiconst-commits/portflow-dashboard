import { useEffect, useId, useState } from 'react';
import { getLfdPriorityAlerts } from '../utils/lfdAlerts.js';
import './DispatchLfdAlerts.css';

const groups = [['overdue', 'Past LFD'], ['today', 'Today'], ['tomorrow', 'Tomorrow']];
export default function DispatchLfdAlerts({ loads, timeZone, onOpenLoad }) {
  const [now, setNow] = useState(() => new Date());
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const panelId = useId();
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const alerts = getLfdPriorityAlerts(loads, now, timeZone);
  const counts = Object.fromEntries(groups.map(([key]) => [key, alerts.filter(a => a.priority === key).length]));
  const needle = query.trim().toLowerCase();
  const visible = alerts.filter(a => (filter === 'all' || a.priority === filter) &&
    [a.load.id, a.load.containerNumber, a.load.customer, a.load.pickupLocationName, a.load.pickup].some(value => String(value || '').toLowerCase().includes(needle)));
  if (!alerts.length) return null;
  return <section className="dispatch-lfd-alerts" aria-label="LFD watch">
    <div className="lfd-watch-bar">
      <div className="lfd-watch-title"><span className={`lfd-watch-icon ${counts.overdue || counts.today ? 'urgent' : ''}`} aria-hidden="true">!</span><strong>LFD watch</strong><span className="lfd-watch-total" role="status">{alerts.length} unassigned</span></div>
      <div className="lfd-watch-counts" aria-label="Filter LFD alerts">
        {groups.map(([key, label]) => <button key={key} type="button" className={`lfd-watch-count ${key}`} aria-pressed={expanded && filter === key} onClick={() => { setFilter(key); setQuery(''); setExpanded(true); }}><span>{label}</span><b>{counts[key]}</b></button>)}
      </div>
      <button type="button" className="lfd-watch-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => { if (!expanded) { setFilter('all'); setQuery(''); } setExpanded(!expanded); }}>{expanded ? 'Collapse' : 'Review'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button>
    </div>
    {expanded && <div id={panelId} className="lfd-watch-panel">
      <div className="lfd-watch-tools">
        <button type="button" className="lfd-watch-all" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All ({alerts.length})</button>
        <input type="search" aria-label="Search LFD alerts" placeholder="Container, load, customer or pickup…" value={query} onChange={e => setQuery(e.target.value)} />
        <span>{visible.length} shown</span>
      </div>
      <ul className="lfd-watch-list">
        {visible.map(({load, date, days, priority}) => <li key={load.id}>
          <span className={`lfd-watch-due ${priority}`}>{days < 0 ? `${Math.abs(days)}d past LFD` : days === 0 ? 'LFD today' : 'LFD tomorrow'}</span>
          <div className="lfd-watch-load"><strong>{load.containerNumber || `Load ${load.id}`}</strong><span title={[load.customer, load.pickupLocationName || load.pickup].filter(Boolean).join(' · ')}>{[load.customer, load.pickupLocationName || load.pickup].filter(Boolean).join(' · ') || `Load ${load.id}`}</span></div>
          <time dateTime={date}>{date.slice(5).replace('-', '/')}</time>
          <button type="button" className="lfd-watch-assign" aria-label={`Assign driver to ${load.containerNumber || load.id}`} onClick={() => onOpenLoad(load)}>Assign driver <span aria-hidden="true">↗</span></button>
        </li>)}
      </ul>
      {!visible.length && <p className="lfd-watch-empty">No unassigned containers match this view.</p>}
      <p className="lfd-watch-hint">Assign a driver to clear the alert. Removing the driver brings it back. Dates follow your company’s time zone.</p>
    </div>}
  </section>;
}
