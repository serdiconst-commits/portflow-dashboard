import { useState } from 'react';

export default function AccountingRestoreMenu({ onCompleted, onDispatch, disabled = false }) {
  const [open, setOpen] = useState(false);
  const choose = (action) => { setOpen(false); action(); };
  return <div className="accounting-restore-control">
    <button type="button" className="danger-btn compact-btn" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>⚠ Restore</button>
    {open && <div className="accounting-restore-options" role="group" aria-label="Restore destination" onKeyDown={(event) => {
      if (event.key === 'Escape') setOpen(false);
    }}>
      <strong>Choose restore destination</strong>
      <button type="button" className="secondary-btn compact-btn" onClick={() => choose(onCompleted)}>To Completed — review again</button>
      <button type="button" className="secondary-btn compact-btn danger-btn" onClick={() => choose(onDispatch)}>To Dispatch — reactivate load</button>
      <button type="button" className="secondary-btn compact-btn" onClick={() => setOpen(false)}>Cancel</button>
    </div>}
  </div>;
}
