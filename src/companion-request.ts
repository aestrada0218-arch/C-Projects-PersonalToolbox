// Keep interrupted writes tied to the session's current desktop process.
// The suffix remains random; restarting the desktop rotates the prefix.
export function companionRequestPrefix(sessionDigest: string) {
  return `${sessionDigest.slice(0, 8)}-${sessionDigest.slice(8, 12)}-4${sessionDigest.slice(13, 16)}-8${sessionDigest.slice(17, 20)}-`;
}
