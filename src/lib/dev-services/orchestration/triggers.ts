/**
 * Cross-service event triggers.
 * Called by the event worker when processing normalized webhook events.
 * Re-exports the core logic from linker.ts for use in webhook-handlers.
 */
export { processMREvent, extractTicketRefs, transitionTicket } from "./linker";
