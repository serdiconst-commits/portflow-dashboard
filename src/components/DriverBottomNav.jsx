import './DriverBottomNav.css';

const tabs = [
  { id: 'active', label: 'Active', icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></> },
  { id: 'paperwork', label: 'Paperwork', icon: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></> },
  { id: 'completed', label: 'Completed', icon: <><circle cx="12" cy="12" r="9" /><path d="m7.5 12 3 3 6-6" /></> },
  { id: 'fuel', label: 'Fuel', icon: <><path d="M3 21h12M5 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M5 10h9M14 12h2a2 2 0 0 1 2 2v3a2 2 0 0 0 4 0V9l-4-4M19 6v4h3" /></> },
  { id: 'payments', label: 'Paystubs', icon: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2ZM8 8h8M8 12h8M8 16h4" /></> },
  { id: 'profile', label: 'Profile', icon: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></> },
];

export default function DriverBottomNav({ activeTab, onSelect }) {
  return (
    <nav className="driver-tab-bar" aria-label="Driver navigation">
      {tabs.map(({ id, label, icon }) => (
        <button key={id} type="button" className={activeTab === id ? 'active' : ''}
          aria-current={activeTab === id ? 'page' : undefined} onClick={() => onSelect(id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{icon}</svg>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
