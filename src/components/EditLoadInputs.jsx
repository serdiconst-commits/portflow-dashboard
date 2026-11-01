import { useId, useState } from 'react';

export function SavedLocationInput({ label, name, value = '', options, onChange, formatAddress }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(-1);
  const query = showAll ? '' : value.trim().toLocaleLowerCase();
  const matches = options.filter((location) =>
    `${location.name || ''} ${formatAddress(location)}`.toLocaleLowerCase().includes(query)
  );
  const select = (location) => {
    onChange({ target: { name, value: formatAddress(location) } });
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="location-search-field edit-saved-location" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <label htmlFor={id}>{label}</label>
      <div className="location-search-row">
        <input id={id} name={name} value={value} autoComplete="off" role="combobox"
          aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
          placeholder="Search saved name or address"
          onFocus={() => { setOpen(true); setShowAll(true); setActive(-1); }}
          onChange={(event) => { onChange(event); setShowAll(false); setOpen(true); setActive(-1); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true);
              if (!matches.length) { setActive(-1); return; }
              const next = Math.max(0, Math.min(matches.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
              setActive(next);
              document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: 'nearest' });
            }
            if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (matches[active]) select(matches[active]);
            }
          }} />
        <button type="button" className="secondary-btn compact-btn" aria-label={`Show saved ${label.toLowerCase()} locations`}
          aria-expanded={open} aria-controls={`${id}-list`}
          onClick={() => { setShowAll(true); setOpen(!open); setActive(-1); }}>▾</button>
      </div>
      {open && <div id={`${id}-list`} className="location-search-menu" role="listbox" aria-label={label}>
        {matches.map((location, index) => <button type="button" key={location.id}
          id={`${id}-option-${index}`} className={`location-search-option${index === active ? ' is-active' : ''}`}
          role="option" aria-selected={formatAddress(location) === value}
          onMouseDown={(event) => event.preventDefault()} onClick={() => select(location)}>
          <strong>{location.name || formatAddress(location)}</strong><span>{formatAddress(location)}</span>
        </button>)}
        {!matches.length && <div className="location-search-empty">No saved locations found. You can keep the entered address.</div>}
      </div>}
    </div>
  );
}

export function AppointmentInput({ value = '', onChange }) {
  const date = value.split('T')[0] || '';
  const time = value.split('T')[1]?.slice(0, 5) || '00:00';
  const [hour, minute] = time.split(':');
  const update = (nextDate, nextHour = hour, nextMinute = minute) => {
    onChange({ target: { name: 'appointmentTime', value: nextDate ? `${nextDate}T${nextHour}:${nextMinute}` : '' } });
  };
  const updatePart = (part, raw) => {
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 0 || number > (part === 'hour' ? 23 : 59)) return;
    const padded = String(number).padStart(2, '0');
    update(date, part === 'hour' ? padded : hour, part === 'minute' ? padded : minute);
  };
  return <fieldset className="edit-appointment">
    <legend>Appointment Time</legend>
    <label>Date<input type="date" aria-label="Appointment date" value={date} onChange={(event) => update(event.target.value)} /></label>
    <div className="edit-appointment-clock">
      <label>Hour (0–23)<input type="number" inputMode="numeric" min="0" max="23" step="1" disabled={!date}
        aria-label="Appointment hour (0–23)" value={date ? Number(hour) : ''} onChange={(event) => updatePart('hour', event.target.value)} /></label>
      <label>Minutes<input type="number" inputMode="numeric" min="0" max="59" step="1" disabled={!date}
        aria-label="Appointment minutes" value={date ? Number(minute) : ''} onChange={(event) => updatePart('minute', event.target.value)} /></label>
      <button type="button" className="secondary-btn compact-btn" disabled={!date} onClick={() => update('')}>Clear</button>
    </div>
    <small>24-hour time: 14:30 = 2:30 PM</small>
  </fieldset>;
}
