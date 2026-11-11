/**
 * In-process event bus feeding each browser's single multiplexed SSE stream.
 * Every event carries a workspaceId; subscribers only receive events for
 * workspaces they are members of (enforced at subscribe time AND per event).
 */
export interface BusEvent {
  type: string;
  workspaceId: number;
  conversationId?: number;
  payload: unknown;
}

type Listener = (e: BusEvent) => void;

export class EventBus {
  private listeners = new Set<{ workspaces: Set<number>; fn: Listener }>();

  publish(e: BusEvent) {
    for (const l of this.listeners) {
      if (l.workspaces.has(e.workspaceId)) {
        try {
          l.fn(e);
        } catch {
          /* a broken subscriber must not affect others */
        }
      }
    }
  }

  subscribe(workspaces: Iterable<number>, fn: Listener): () => void {
    const entry = { workspaces: new Set(workspaces), fn };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }

  get size() {
    return this.listeners.size;
  }
}
