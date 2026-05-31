export function connectionLabel(status, joined = false) {
  if (!joined) return 'Ready'

  switch (status) {
    case 'connected':
      return 'Online'
    case 'connecting':
      return 'Connecting'
    case 'local':
    case 'offline':
    case 'error':
      return 'Solo ready'
    default:
      return 'Ready'
  }
}

export function connectionTone(status, joined = false) {
  if (!joined) return 'idle'
  if (status === 'connected') return 'online'
  if (status === 'connecting') return 'pending'
  return 'local'
}
