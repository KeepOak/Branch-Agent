import { useEffect } from "react";
import type { SaplingSession } from "../connect/session";
import { PetCompletion } from "./pet-completion";
import { reactPet } from "./pet-reaction";

export function usePetCompletion(session: SaplingSession): void {
  useEffect(() => {
    const completion = new PetCompletion(session.getSnapshot());
    const events = session.onGatewayEvent((event, payload) => completion.record(event, payload, session.getSnapshot()));
    const snapshots = session.subscribe(() => { if (completion.advance(session.getSnapshot())) reactPet("cheer"); });
    return () => { events(); snapshots(); };
  }, [session]);
}
