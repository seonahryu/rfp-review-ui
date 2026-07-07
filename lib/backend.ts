/**
 * Base URL of the deployed RFP review backend.
 * Override via the BACKEND_API_URL environment variable if the address changes.
 */
export const BACKEND_API_URL = (
  process.env.BACKEND_API_URL || "https://rfp-review-agent.onrender.com"
).replace(/\/$/, "")
