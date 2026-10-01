import { useEffect, useState } from 'react';
import { getLfdTodayAlerts } from '../utils/lfdAlerts.js';
import './DispatchLfdAlerts.css';

export default function DispatchLfdAlerts({ loads, timeZone, onOpenLoad }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const alerts = getLfdTodayAlerts(loads, now, timeZone);
  if (!alerts.length) return null;
  return (
    <section className="dispatch-lfd-alerts" aria-label="LFD today alerts" aria-live="polite">
      <div className="dispatch-lfd-alerts-heading">
        <strong>LFD today · {alerts.length} unassigned {alerts.length === 1 ? 'container' : 'containers'}</strong>
        <span>Assign a driver to clear each alert.</span>
      </div>
      <ul>
        {alerts.map(load => (
          <li key={load.id}>
            <span><strong>{load.containerNumber ? `The container ${load.containerNumber} LFD is today.` : `Load ${load.id} LFD is today.`}</strong> No driver assigned.</span>
            <button type="button" className="secondary-btn" onClick={() => onOpenLoad(load)}
              aria-label={`Assign driver to ${load.containerNumber || load.id}`}>Assign driver</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
