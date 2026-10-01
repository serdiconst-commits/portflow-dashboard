import { useId } from 'react';
import { payrollLocationOptions } from '../utils/payrollLocations.js';

export default function PayrollRouteFields({ locations = [], pickup = '', delivery = '' }) {
  const id = useId();
  return (
    <div className="payroll-route-fields">
      {[
        ['pickup', 'Pickup location', 'pickupLocation', pickup],
        ['delivery', 'Delivery location', 'deliveryLocation', delivery],
      ].map(([kind, label, name, value]) => (
        <label key={kind}>
          {label}
          <input name={name} list={`${id}-${kind}`} defaultValue={value || ''} maxLength={500}
            placeholder={`Search saved ${kind} locations or type a location`} autoComplete="off" />
          <datalist id={`${id}-${kind}`}>
            {payrollLocationOptions(locations, kind).map(option => <option key={option} value={option} />)}
          </datalist>
        </label>
      ))}
    </div>
  );
}
