import { ChatList, useIsMobile } from '../components/Shell';
import { IChat, LargeTitle } from '../components/ui';
import { useWs } from '../lib/workspace';

/** iPhone: the Chats screen. Mac: the empty right pane, like Messages with nothing selected. */
export function HomeRedirect() {
  const { ws, me } = useWs();
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <div className="scroll h-full">
        <LargeTitle title="Chats" subtitle={me.workspaces.length > 1 ? ws.name : undefined} />
        <ChatList />
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center text-[var(--label-2)]">
      <IChat size={56} className="text-[var(--label-3)]" />
      <p className="t-title mt-3 text-[var(--label)]">Pick someone to talk to</p>
      <p className="t-sub mt-1">Choose a chat on the left.</p>
    </div>
  );
}
