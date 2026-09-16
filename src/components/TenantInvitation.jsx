import { useState } from 'react';
import './TenantInvitation.css';
const emptyCompany = { name:'', adminName:'', email:'', scac:'', subscriptionPlan:'Trial', serviceStatus:'Trial' };

export default function TenantInvitation({ apiBase, authToken, onCreated }) {
  const [form,setForm] = useState(emptyCompany);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [result,setResult] = useState(null);
  const change = (event) => setForm({...form,[event.target.name]:event.target.value});
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(''); setResult(null);
    try {
      const response = await fetch(`${apiBase}/api/tenant-management/companies`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},body:JSON.stringify(form)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to create company.');
      setResult(data); setForm(emptyCompany); setMessage(data.message);
      await onCreated();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <details className="tenant-invitation">
    <summary>Create company & invite administrator</summary>
    <p>Create the company here. Its administrator receives a secure link to choose a password; no password needs to be shared.</p>
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="tenant-invitation-fields">
        <label>Company name<input name="name" value={form.name} onChange={change} required maxLength={150} autoComplete="organization" /></label>
        <label>Administrator name<input name="adminName" value={form.adminName} onChange={change} required maxLength={150} autoComplete="name" /></label>
        <label>Administrator email<input type="email" name="email" value={form.email} onChange={change} required maxLength={254} autoComplete="email" /></label>
        <label>SCAC (if applicable)<input name="scac" value={form.scac} onChange={(event)=>setForm({...form,scac:event.target.value.toUpperCase()})} pattern="[A-Za-z]{2,4}" maxLength={4} placeholder="DROS" /></label>
        <label>Plan<input name="subscriptionPlan" value={form.subscriptionPlan} onChange={change} required maxLength={100} /></label>
        <label>Company status<select name="serviceStatus" value={form.serviceStatus} onChange={change}><option>Trial</option><option>Active</option></select></label>
      </fieldset>
      <p className="tenant-invitation-note">The invitation expires in 24 hours. Access starts after activation and remains subject to the company status.</p>
      <button className="primary-btn" disabled={busy} type="submit">{busy ? 'Creating company…' : 'Create & send invitation'}</button>
    </form>
    {message && <p role="status" className="tenant-invitation-message">{message}</p>}
    {result && !result.invitationSent && <p>Find the new company below and choose <strong>Resend invitation</strong>.</p>}
  </details>;
}

export function TenantInvitationStatus({ tenant, apiBase, authToken, onSent }) {
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const resend = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${apiBase}/api/tenant-management/companies/${encodeURIComponent(tenant.id)}/invitation`, {method:'POST',headers:{Authorization:`Bearer ${authToken}`}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to resend invitation.');
      setMessage(data.message); await onSent();
    } catch(error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <div className="tenant-invitation-status">
    {tenant.portHoustonScac && <span>SCAC: <strong>{tenant.portHoustonScac}</strong></span>}
    {tenant.invitationStatus && <span>{tenant.invitationStatus}</span>}
    {tenant.invitationStatus && tenant.invitationStatus !== 'Activated' && <button type="button" className="secondary-btn compact-btn" disabled={busy} onClick={resend}>{busy ? 'Sending…' : 'Resend invitation'}</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
