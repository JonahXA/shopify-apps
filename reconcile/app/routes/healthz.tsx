import { json } from "@remix-run/node";

/** Liveness probe for the host (Render/Fly). No auth, no DB — just "up". */
export const loader = () => json({ ok: true });
