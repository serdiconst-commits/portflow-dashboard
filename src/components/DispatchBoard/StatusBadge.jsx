import { slugifyStatus } from './dispatchStatusConfig.js';

export default function StatusBadge({ status }) {
  const slug = slugifyStatus(status);
  return <span className={`sheet-status ${slug}`}>{status || '-'}</span>;
}
