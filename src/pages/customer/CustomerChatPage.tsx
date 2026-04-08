// CustomerChatPage — now powered by the unified chat platform
// Customers share the same chat_rooms / chat_messages tables as merchants.
// The old customer_messages table data has been migrated into chat_messages.
import ChatWorkspacePage from '@/features/chat/pages/ChatWorkspacePage';

export default function CustomerChatPage() {
  return <ChatWorkspacePage />;
}
