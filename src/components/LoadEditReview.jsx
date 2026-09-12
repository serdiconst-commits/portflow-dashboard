import { useEffect, useRef } from 'react';
import './LoadEditReview.css';

export default function LoadEditReview({ loadId, changes, onDecision }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return (
    <dialog ref={dialog} className="load-edit-review" aria-labelledby="load-edit-review-title"
      onCancel={(event) => { event.preventDefault(); onDecision(false); }}>
      <header>
        <p>LOAD # {loadId}</p>
        <h2 id="load-edit-review-title">Review your changes</h2>
        <span>Check the details below before saving this load.</span>
      </header>
      <div className="load-edit-review-scroll">
        <table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
          <tbody>{changes.map((change) => <tr key={change.key}>
            <th scope="row">{change.label}</th><td>{change.before}</td><td>{change.after}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {changes.some((change) => change.key === 'workflowType') &&
        <p className="load-edit-review-note">Completed movements and their pay remain in the movement history.</p>}
      <footer>
        <button type="button" className="secondary-btn" autoFocus onClick={() => onDecision(false)}>Go back to edit</button>
        <button type="button" className="primary-btn" onClick={() => onDecision(true)}>Confirm &amp; save</button>
      </footer>
    </dialog>
  );
}
