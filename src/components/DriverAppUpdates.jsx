import { useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { initialDriverPushPermission } from '../utils/driverPushPermission.js';
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

export default function DriverAppUpdates({ apiBase, authToken, onNotification, onRefresh, showSettings = false }) {
  const [release, setRelease] = useState(null);
  const [status, setStatus] = useState('');
  const callbacks = useRef({ onNotification, onRefresh });
  callbacks.current = { onNotification, onRefresh };
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
    let checking = false;
    let ready = !native;
    const check = async () => {
      if (checking || disposed || !ready) return;
      checking = true;
      try {
        const response = await fetch(`${apiBase}/api/driver-app/release?platform=${platform}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (disposed) return;

        if (native) {
          const info = await App.getInfo();
          if (!disposed) setRelease(newerVersion(info.version, data.version) ? { ...data, url: safeStoreUrl(data.storeUrl, platform) } : null);
        }
        if (native && data.pushAvailable && !disposed) {
          const permission = await initialDriverPushPermission(PushNotifications, localStorage);
          if (disposed) return;
          if (permission.receive === 'granted') await PushNotifications.register();
          else setStatus('Allow PortFlow notifications in your phone Settings to receive dispatch alerts.');
        }
      } catch { /* Retry on resume or the next scheduled check without interrupting work. */ }
      finally { checking = false; }
    };
    const setup = async () => {
      if (!native) return;
      await add('registration', async ({ value }) => {
        if (disposed) return;
        try {
          registeredToken = value;
          localStorage.setItem(tokenKey, value);
          const response = await fetch(`${apiBase}/api/driver-app/devices`, { method: 'PUT', headers, body: JSON.stringify({ token: value, platform }) });
          if (!response.ok) throw new Error();
          registeredToken = value;
          if (!disposed) setStatus('Notifications enabled. Keep your phone volume up.');
        } catch { if (!disposed) setStatus('Notifications could not connect. PortFlow will retry when you reopen the app.'); }
      });
      await add('registrationError', () => { if (!disposed) setStatus('Notifications could not connect. PortFlow will retry when you reopen the app.'); });
      await add('pushNotificationReceived', notification => { if (!disposed) { callbacks.current.onNotification(notification.title || 'Dispatch update', notification.body || 'Open your loads to see the changes.'); callbacks.current.onRefresh(); } });
      await add('pushNotificationActionPerformed', () => { if (!disposed) callbacks.current.onRefresh(); });
      if (platform === 'android') await PushNotifications.createChannel({ id: 'driver-dispatch-v1', name: 'Dispatch changes', importance: 5, visibility: 1, vibration: true, sound: 'driver_alert.wav' });
      ready = true;
    };
    const resume = () => { if (!document.hidden) { check(); callbacks.current.onRefresh(); } };
    setup().then(check).catch(() => { if (!disposed) setStatus('Push notifications are unavailable in this build.'); });
    const timer = setInterval(check, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', resume);
    const nativeResume = native ? App.addListener('appStateChange', ({ isActive }) => { if (isActive) { check(); callbacks.current.onRefresh(); } }) : null;
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', resume); listeners.forEach(listener => listener.remove()); nativeResume?.then(listener => listener.remove()); };
  }, [apiBase, authToken, platform, native]);

  const testSound = async () => {
    try { await enableDriverSound(); await playDriverAlert(true); }
    catch { setStatus('Could not play the sound. Check your phone volume and try again.'); }
  };
  return <div className="driver-update-notices">
    {release && <section className="driver-update-banner" role="status"><strong>A new version of PortFlow Driver is available</strong><p>Version {release.version}. Update when you are safely parked.</p>{release.url ? <a href={release.url} target="_blank" rel="noreferrer">Update app</a> : <p>Open {platform === 'ios' ? 'the App Store' : 'Google Play'} to update PortFlow Driver.</p>}</section>}
    <details className="driver-alert-settings" hidden={!showSettings}><summary>Notification settings</summary><p>Dispatch alerts follow your phone notification permissions and sound settings.</p><button type="button" onClick={testSound}>Test alert sound</button>{status && <p role="status">{status}</p>}</details>
  </div>;
}
