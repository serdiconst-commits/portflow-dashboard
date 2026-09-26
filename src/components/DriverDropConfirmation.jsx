import { useEffect, useRef } from 'react';
export default function DriverDropConfirmation({ load, onCancel, onConfirm }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const destination = load.currentMove?.destination || (load.workflowType === 'PRE_PULL_LIVE' ? load.dropLocation : load.delivery) || load.dropLocation;
  return <dialog ref={dialog} className="driver-drop-confirmation" aria-labelledby="driver-drop-title" onCancel={onCancel}>
    <h2 id="driver-drop-title">Are you sure you want to drop it?</h2>
    <p>Confirm only after you have dropped this container at the location below.</p>
    <dl><dt>Container / Load</dt><dd>{load.containerNumber || load.id}</dd><dt>Drop location</dt><dd>{destination || 'Location not provided — check with dispatch.'}</dd></dl>
    <div className="driver-confirm-actions">
      <button type="button" autoFocus onClick={onCancel}>Cancel</button>
      <button type="button" className="primary-btn" onClick={onConfirm}>Yes, confirm drop</button>
    </div>
  </dialog>;
}
