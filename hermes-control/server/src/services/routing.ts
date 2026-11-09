/**
 * Decides which Hermes profile(s) a human message is delivered to.
 *
 * Rules (deterministic, no LLM involved):
 *  1. DM: always the DM's agent.
 *  2. Channel: every explicitly addressed agent that is a member of the channel —
 *     "@jeff", "@Jeff", or a leading vocative "Jeff, ..." / "Jeff: ...".
 *     Matching is by profile id or display name, case-insensitive, word-bounded.
 *  3. Channel with no addressee: the channel's default agent, if configured; else nobody
 *     (the message is a human note and nothing is sent to Hermes).
 *
 * "Jeff, ask Debra to review the budget" is delivered to Jeff ONLY. Debra is mentioned
 * inside the instruction, not addressed; Jeff decides how to delegate via Hermes' own
 * mechanisms (Kanban, delegation). Hermes Control never fabricates Debra's answer.
 */
export interface RoutableAgent {
  id: number;
  profileName: string;
  displayName: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function resolveTargets(
  body: string,
  conv: { kind: 'channel' | 'dm' | 'telegram_mirror'; dmAgentId?: number | null; defaultAgentId?: number | null },
  members: RoutableAgent[],
): RoutableAgent[] {
  if (conv.kind === 'telegram_mirror') return [];
  if (conv.kind === 'dm') return members.filter((m) => m.id === conv.dmAgentId);

  const text = body.trim();
  const hits = new Map<number, RoutableAgent>();
  for (const a of members) {
    const names = [a.profileName, a.displayName].filter(Boolean).map(esc);
    const alt = names.join('|');
    const mention = new RegExp(`(^|[^\\w@])@(${alt})(?![\\w-])`, 'i');
    const vocative = new RegExp(`^(?:hey\\s+|hi\\s+)?(${alt})\\s*[,:]`, 'i');
    if (mention.test(text) || vocative.test(text)) hits.set(a.id, a);
  }
  if (hits.size) return [...hits.values()];
  if (conv.defaultAgentId) return members.filter((m) => m.id === conv.defaultAgentId);
  return [];
}
