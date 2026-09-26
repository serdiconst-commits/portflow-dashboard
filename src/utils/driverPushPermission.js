const permissionPromptKey = 'portflow-notification-permission-requested';
let permissionRequest;

// One OS prompt per installation, including React remounts and app resumes.
export async function initialDriverPushPermission(push, storage) {
  const permission = await push.checkPermissions();
  if (permission.receive !== 'prompt' && permission.receive !== 'prompt-with-rationale') return permission;
  if (permissionRequest) return permissionRequest;
  if (storage.getItem(permissionPromptKey)) return permission;
  permissionRequest = (async () => {
    const result = await push.requestPermissions();
    storage.setItem(permissionPromptKey, '1');
    return result;
  })();
  try { return await permissionRequest; }
  finally { permissionRequest = undefined; }
}
