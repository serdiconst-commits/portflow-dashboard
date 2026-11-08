export default function DropPickPayInputs({ load, onChange }) {
  if (load.workflowType !== 'DROP_AND_PICK') return <input type="text" name="driverRate" placeholder="Driver Rate" value={load.driverRate} onChange={onChange} required />;
  return <fieldset className="drop-pick-pay-inputs">
    <legend>Drop &amp; Pick · Driver Pay</legend>
    <label>Drop Pay<input type="number" name="dropPay" min="0" step="0.01" required value={load.dropPay ?? load.driverRate ?? ''} onChange={onChange} placeholder="0.00" /></label>
    <label>Pickup / Return Pay<input type="number" name="pickupPay" min="0" step="0.01" required value={load.pickupPay ?? ''} onChange={onChange} placeholder="0.00" /></label>
    <small>The driver sees the pay for the assigned movement. Each movement enters payroll when completed.</small>
  </fieldset>;
}
