import type { User as DbUser } from "@shared/models/schema";

// Make req.user resolve to the PDTC user row across the server.
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends DbUser {}
  }
}

export {};
