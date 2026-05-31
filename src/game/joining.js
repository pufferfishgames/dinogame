export const SESSION_IDENTITY_KEY = 'dinogame.session.identity.v1'
export const PERSISTENT_IDENTITY_KEY = 'dinogame.identity.v1'

export function getOrCreateSessionPassphrase({
  sessionStorage,
  localStorage,
  createPassphrase,
  sessionKey = SESSION_IDENTITY_KEY,
  persistentKey = PERSISTENT_IDENTITY_KEY,
}) {
  const existingSession = readStorage(sessionStorage, sessionKey)
  if (existingSession) return existingSession

  if (sessionStorage) {
    const passphrase = createPassphrase()
    writeStorage(sessionStorage, sessionKey, passphrase)
    return passphrase
  }

  const existingPersistent = readStorage(localStorage, persistentKey)
  if (existingPersistent) return existingPersistent

  const passphrase = createPassphrase()
  writeStorage(localStorage, persistentKey, passphrase)
  return passphrase
}

function readStorage(storage, key) {
  try {
    return storage?.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStorage(storage, key, value) {
  try {
    storage?.setItem(key, value)
  } catch {
    // Private browsing modes can reject writes; the in-memory value still works.
  }
}
