export type ScanPhase =
  "credentials" | "receipts" | "storage" | "shipments" | "sales";
// Return fixed guidance only. Never expose server responses, command text or mail content.
export function scanError(error: unknown, phase: ScanPhase): string {
  const e = error as {
    code?: string;
    authenticationFailed?: boolean;
    serverResponseCode?: string;
  };
  const code = typeof e?.code === "string" ? e.code : "";
  if (phase === "storage")
    return "Local storage could not save the scan. Check free disk space and folder permissions, then retry.";
  if (
    phase === "credentials" ||
    (error instanceof Error && error.message === "MISSING_CREDENTIAL")
  )
    return "Saved IMAP credentials are missing or unavailable. Reconnect this inbox using its provider app password.";
  if (
    e?.authenticationFailed ||
    e?.serverResponseCode === "AUTHENTICATIONFAILED"
  )
    return "IMAP sign-in was rejected. Reconnect this inbox with a current app password; Gmail requires Google two-step verification and a Google app password.";
  if (
    [
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "SELF_SIGNED_CERT_IN_CHAIN",
    ].includes(code)
  )
    return "The IMAP TLS certificate could not be verified. Check the server hostname, Windows date/time and network security software. TLS verification remains enabled.";
  if (
    [
      "ETIMEDOUT",
      "ETIMEOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "NoConnection",
      "ConnectionClosed",
    ].includes(code)
  )
    return `The ${phase} scan lost its secure IMAP connection or timed out. Check the hostname, TLS port and network, then retry. Saved progress is retained.`;
  if (e?.serverResponseCode === "NONEXISTENT" || code === "MAIL_FOLDER")
    return "The configured IMAP folder could not be opened. Check its exact folder name in Inbox settings; Gmail commonly uses INBOX or [Gmail]/All Mail.";
  return `Could not complete a secure mailbox scan during ${phase}. Check this inbox's IMAP access and folder settings, then retry. Saved purchases were retained.`;
}
