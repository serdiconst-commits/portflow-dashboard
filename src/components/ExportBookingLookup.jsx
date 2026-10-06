import { formatPortDateTime } from '../../shared/exportReceiving.js';
import './ExportBookingLookup.css';
import { useEffect, useRef, useState } from 'react';

export default function ExportBookingLookup({ bookingNumber, apiBase, authToken, onApply }) {
  const [bookings, setBookings] = useState([]);
  const [selection, setSelection] = useState('');
  const [equipmentIndex, setEquipmentIndex] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef(null);
  useEffect(() => {
    request.current?.abort();
    setBookings([]);
    setSelection('');
    setEquipmentIndex('');
    setMessage('');
    setLoading(false);
    return () => request.current?.abort();
  }, [bookingNumber, authToken]);

  const choose = (index, records = bookings) => {
    setSelection(index);
    setEquipmentIndex(records[Number(index)]?.equipment.length === 1 ? '0' : '');
  };
  const search = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setBookings([]);
    setSelection('');
    setEquipmentIndex('');
    setMessage('Checking Port Houston…');
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const params = new URLSearchParams({ bookingNumber: bookingNumber.trim() });
      const response = await fetch(`${apiBase}/api/port-houston/booking-lookup?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to check this booking.');
      if (request.current !== controller || controller.signal.aborted) return;
      const records = Array.isArray(data.bookings) ? data.bookings : [];
      setBookings(records);
      if (records.length === 1) {
        choose('0', records);
        const record = records[0];
        const note = onApply({ ...record, containerSize: record.equipment.length === 1 ? record.equipment[0].containerSize : '' });
        setMessage(note + (record.equipment.length > 1 ? ' Select the equipment size below.' : ''));
      } else {
        setMessage(records.length ? 'Select the booking / vessel before applying its details.' : 'Booking not found in Port Houston. You can enter the details manually.');
      }
    } catch (error) {
      if (request.current === controller) {
        setMessage(error.name === 'AbortError' ? 'Lookup canceled or timed out. Please try again.' : error.message);
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  };
  const selected = selection === '' ? null : bookings[Number(selection)];
  const equipment = equipmentIndex === '' ? null : selected?.equipment[Number(equipmentIndex)];
  return (
    <div className="smart-port-lookup export-booking-lookup">
      <button type="button" className="primary-btn smart-port-lookup-btn" disabled={loading || !bookingNumber.trim()} onClick={search}>
        {loading ? 'Checking Booking…' : 'Search Export Booking'}
      </button>
      <p className="smart-port-status" role="status">{message || 'Look up the shipping line, equipment size and outbound terminal by Booking #.'}</p>
      {bookings.length > 1 && <label>Booking / vessel
        <select value={selection} onChange={event => { choose(event.target.value); setMessage('Review the booking details. Applying fills empty fields only.'); }}>
          <option value="">Select booking / vessel</option>
          {bookings.map((record, index) => <option key={index} value={index}>{record.shipLine} · {record.vesselName || 'Vessel not returned'} · {record.terminalName || 'Terminal not returned'}</option>)}
        </select>
      </label>}
      {selected && <div style={{ width: '100%' }}>
        <p><strong>Ship line:</strong> {selected.shipLine || 'Not returned'}{selected.lineScac && ` (${selected.lineScac})`}</p>
        <p><strong>Outbound terminal:</strong> {selected.terminalName || 'Not returned'}</p>
        <p><strong>Beginning Receiving (Houston):</strong> {selected.beginReceiving ? formatPortDateTime(selected.beginReceiving) : 'Not returned'}</p>
        <p><strong>Cutoff — Full Return (Houston):</strong> {selected.exportCutoff ? formatPortDateTime(selected.exportCutoff) : 'Not returned'}</p>
        <p><strong>Vessel:</strong> {selected.vesselName || 'Not returned'}</p>
        {selected.equipment.length > 1 ? <label>Equipment size
          <select value={equipmentIndex} onChange={event => setEquipmentIndex(event.target.value)}>
            <option value="">Select equipment size</option>
            {selected.equipment.map((item, index) => <option key={index} value={index}>{item.label}</option>)}
          </select>
        </label> : <p><strong>Equipment size:</strong> {selected.equipment[0]?.label || 'Not returned'}</p>}
        <button type="button" className="secondary-btn" disabled={selected.equipment.length > 1 && !equipment} onClick={() => {
          setMessage(onApply({ ...selected, containerSize: equipment?.containerSize || '' }));
        }}>Apply Booking Details</button>
      </div>}
    </div>
  );
}
