import './DriverCompletedFilter.css';

export default function DriverCompletedFilter({ from, to, onFromChange, onToChange, onClear, count }) {
  const invalid = Boolean(from && to && from > to);
  return <section className="driver-completed-filter" aria-label="Completed load dates">
    <div className="driver-completed-filter-heading"><div><h2>Completed</h2><p>Most recent first · {count} loads</p></div>
      <button type="button" onClick={onClear} disabled={!from && !to}>Clear dates</button></div>
    <div className="driver-completed-date-fields">
      <label>From<input type="date" value={from} max={to || undefined} onChange={(event) => onFromChange(event.target.value)} aria-invalid={invalid} aria-describedby={invalid ? 'driver-completed-date-error' : undefined} /></label>
      <label>To<input type="date" value={to} min={from || undefined} onChange={(event) => onToChange(event.target.value)} aria-invalid={invalid} aria-describedby={invalid ? 'driver-completed-date-error' : undefined} /></label>
    </div>
    {invalid && <p id="driver-completed-date-error" role="alert">The end date must be on or after the start date.</p>}
  </section>;
}
