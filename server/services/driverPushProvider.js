import { readFile } from 'node:fs/promises';
import http2 from 'node:http2';
import jwt from 'jsonwebtoken';

export function pushConfigured(platform, env = process.env) {
  if (env.DRIVER_PUSH_ENABLED !== 'true') return false;
  return platform === 'ios'
    ? Boolean(env.APNS_KEY_PATH && env.APNS_KEY_ID && env.APNS_TEAM_ID)
    : platform === 'android' && Boolean(env.FCM_SERVICE_ACCOUNT_PATH);
}
const providerError = (code, permanent = false) => Object.assign(new Error(code), { permanent });
let googleToken;
let appleToken;
async function fcmAuth() {
  if (googleToken?.expires > Date.now()) return googleToken;
  const account = JSON.parse(await readFile(process.env.FCM_SERVICE_ACCOUNT_PATH, 'utf8'));
  const assertion = jwt.sign({ scope: 'https://www.googleapis.com/auth/firebase.messaging' }, account.private_key, {
    algorithm: 'RS256', issuer: account.client_email, audience: 'https://oauth2.googleapis.com/token', expiresIn: '1h',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10000), body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw providerError(`FCM authorization ${response.status}`);
  const data = await response.json();
  googleToken = { token: data.access_token, project: account.project_id, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return googleToken;
}
export function driverPushPayload(platform, event) {
  const title = 'PortFlow dispatch update';
  const body = 'Your assigned work has changed. Open PortFlow to review it when safely parked.';
  if (platform === 'ios') return { aps: { alert: { title, body }, sound: 'driver_alert.wav', 'thread-id': 'dispatch' }, eventId: event.id };
  return { notification: { title, body }, data: { eventId: event.id }, android: { priority: 'high', ttl: '3600s', notification: { channel_id: 'driver-dispatch-v1', sound: 'driver_alert', tag: event.id } } };
}
export async function sendDriverPush(device, event) {
  if (!pushConfigured(device.platform)) throw providerError('Push provider is not configured');
  if (device.platform === 'android') {
    const auth = await fcmAuth();
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(auth.project)}/messages:send`, {
      method: 'POST', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { ...driverPushPayload('android', event), token: device.token } }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) googleToken = null;
      const unregistered = result.error?.details?.some(detail => detail.errorCode === 'UNREGISTERED');
      throw providerError(`FCM delivery ${response.status}`, unregistered);
    }
    return;
  }
  const signingIdentity = [process.env.APNS_KEY_PATH, process.env.APNS_TEAM_ID, process.env.APNS_KEY_ID].join(':');
  if (!appleToken || appleToken.identity !== signingIdentity || appleToken.expires <= Date.now()) {
    const key = await readFile(process.env.APNS_KEY_PATH, 'utf8');
    appleToken = { identity: signingIdentity, expires: Date.now() + 50 * 60 * 1000,
      value: jwt.sign({}, key, { algorithm: 'ES256', issuer: process.env.APNS_TEAM_ID, keyid: process.env.APNS_KEY_ID }) };
  }
  const token = appleToken.value;
  const host = process.env.APNS_ENVIRONMENT === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  await new Promise((resolve, reject) => {
    const client = http2.connect(host);
    const finish = error => { client.destroy(); error ? reject(error) : resolve(); };
    client.on('error', () => finish(providerError('APNs connection failed')));
    client.setTimeout(10000, () => finish(providerError('APNs timed out')));
    const request = client.request({ ':method': 'POST', ':path': `/3/device/${device.token}`, authorization: `bearer ${token}`,
      'apns-topic': 'com.portflow.driverapp', 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600) });
    let status, body = '';
    request.on('response', headers => { status = headers[':status']; });
    request.on('data', chunk => { body += chunk; });
    request.on('error', () => finish(providerError('APNs request failed')));
    request.on('end', () => {
      let reason; try { reason = JSON.parse(body).reason; } catch { /* Success has no body. */ }
      finish(status === 200 ? null : providerError(`APNs delivery ${status}`, reason === 'Unregistered' || reason === 'BadDeviceToken'));
    });
    request.end(JSON.stringify(driverPushPayload('ios', event)));
  });
}
