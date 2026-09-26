import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { newerVersion, safeStoreUrl } from '../../shared/driverAlerts.js';
import { enableDriverSound, playDriverAlert } from '../utils/driverAlertSound.js';

let registeredToken = '';
const tokenKey = 'portflow-push-device-token';
export async function removeDriverPushRegistration(apiBase, authToken) {
  registeredToken ||= localStorage.getItem(tokenKey) || '';
  if (!registeredToken) return;
  const response = await fetch(`${apiBase}/api/driver-app/devices`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: registeredToken }) });
  if (!response.ok) throw new Error('Could not turn off notifications for this account. Try again before signing out.');
  registeredToken = '';
  localStorage.removeItem(tokenKey);
}

export default function DriverAppUpdates({ apiBase, authToken, onNotification, onRefresh }) {
  const [release, setRelease] = useState(null);
  const [available, setAvailable] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [status, setStatus] = useState('');
  const platform = Capacitor.getPlatform();
  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    let disposed = false;
    const listeners = [];
    const headers = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
    const add = async (event, callback) => {
      const listener = await PushNotifications.addListener(event, callback);
      if (disposed) await listener.remove(); else listeners.push(listener);
    };
    const check = async () => {
      try {
        const response = await fetch(`${apiBase}/api/driver-app/release?platform=${platform}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (disposed) return;
        setAvailable(Boolean(data.pushAvailable));
        if (native) {
          const info = await App.getInfo();
          if (!disposed) setRelease(newerVersion(info.version, data.version) ? { ...data, url: safeStoreUrl(data.storeUrl, platform) } : null);
        }
        return Boolean(data.pushAvailable);
      } catch { /* Offline checks must not interrupt driver work. */ }
    };
    const setup = async (configured) => {
      if (!native) return;
      await add('registration', async ({ value }) => {
        if (disposed) return;
        try {
          registeredToken = value;
          localStorage.setItem(tokenKey, value);
          const response = await fetch(`${apiBase}/api/driver-app/devices`, { method: 'PUT', headers, body: JSON.stringify({ token: value, platform }) });
          if (!response.ok) throw new Error();
          registeredToken = value;
          if (!disposed) { setPushEnabled(true); setStatus('Notifications enabled. Keep your phone volume up.'); }
        } catch { if (!disposed) setStatus('Notifications could not connect. Tap Enable alerts to retry.'); }
      });
      await add('registrationError', () => { if (!disposed) setStatus('Notifications could not connect. Tap Enable alerts to retry.'); });
      await add('pushNotificationReceived', notification => { if (!disposed) { onNotification(notification.title || 'Dispatch update', notification.body || 'Open your loads to see the changes.'); onRefresh(); } });
      await add('pushNotificationActionPerformed', () => { if (!disposed) onRefresh(); });
      if (platform === 'android') await PushNotifications.createChannel({ id: 'driver-dispatch-v1', name: 'Dispatch changes', importance: 5, visibility: 1, vibration: true, sound: 'driver_alert.wav' });
      const permission = await PushNotifications.checkPermissions();
      if (configured && permission.receive === 'granted' && !disposed) await PushNotifications.register();
    };
    const resume = () => { if (!document.hidden) { check(); onRefresh(); } };
    check().then(setup).catch(() => { if (!disposed) setStatus('Push notifications are unavailable in this build.'); });
    const timer = setInterval(check, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', resume);
    const nativeResume = native ? App.addListener('appStateChange', ({ isActive }) => { if (isActive) { check(); onRefresh(); } }) : null;
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', resume); listeners.forEach(listener => listener.remove()); nativeResume?.then(listener => listener.remove()); };
  }, [apiBase, authToken, platform, native]);

  const enable = async () => {
    try {
      await enableDriverSound(); await playDriverAlert(true);
      if (!native) { setStatus('Sound enabled while PortFlow is open. Use the mobile app for alerts when closed.'); return; }
      if (!available) { setStatus('Sound enabled in the app. Notifications while closed are not yet configured.'); return; }
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') { setStatus('Allow PortFlow notifications in your phone Settings, then try again.'); return; }
      if (platform === 'android') await PushNotifications.createChannel({ id: 'driver-dispatch-v1', name: 'Dispatch changes', description: 'New loads and changes from dispatch', importance: 5, visibility: 1, vibration: true, sound: 'driver_alert.wav' });
      await PushNotifications.register();
    } catch { setStatus('Could not enable alerts. Check notification permissions and try again.'); }
  };
  return <div className="driver-update-notices">
    {release && <section className="driver-update-banner" role="status"><strong>A new version of PortFlow Driver is available</strong><p>Version {release.version}. Update when you are safely parked.</p>{release.url ? <a href={release.url} target="_blank" rel="noreferrer">Update app</a> : <p>Open {platform === 'ios' ? 'the App Store' : 'Google Play'} to update PortFlow Driver.</p>}</section>}
    <section className="driver-alert-settings"><button type="button" onClick={enable}>{pushEnabled ? 'Test alert sound' : 'Enable alerts & test sound'}</button>{status && <p role="status">{status}</p>}</section>
  </div>;
}
