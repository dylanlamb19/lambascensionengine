/**
 * Gmail (later): OAuth only. Never send without an explicit Approve.
 *
 * Connect: Google OAuth (gmail.send + gmail.readonly) stored server-side.
 * Send path: DRAFT → READY FOR REVIEW → you click Approve → SENT.
 * Inbound: poll/watch threads → if reply, set REPLIED, classify, draft a response, wait for you.
 * Bounce/unsubscribe: mark UNSUBSCRIBED / BOUNCED, add to suppression, stop sequence.
 * No fake open tracking.
 */
export const GMAIL_NOT_CONNECTED = "Gmail is not connected. Press Connect Gmail on Home. We will not ask for your Gmail password. Nothing is sent until Gmail confirms it.";
