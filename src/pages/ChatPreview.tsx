import ChatWorkspacePage from '@/features/chat/pages/ChatWorkspacePage';

/**
 * ChatPreview - Temporary preview page
 * Now renders the modernized 4-column chat workspace for 100% design parity.
 */
export default function ChatPreview() {
  return (
    <div className="w-full h-screen overflow-hidden bg-white">
      <ChatWorkspacePage />
    </div>
  );
}
