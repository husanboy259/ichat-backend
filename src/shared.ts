// The database uses snake_case (avatar_color), the frontend expects camelCase (avatarColor).
// These two helpers are the translation layer. Every route uses them, so the shapes
// the frontend receives always match types/index.ts.

export function toPublicUser(u: any) {
  return {
    id: u.id,
    username: u.username,
    firstName: u.first_name ?? '',
    lastName: u.last_name ?? '',
    bio: u.bio ?? '',
    phone: u.phone,
    avatarColor: u.avatar_color,
    status: u.status,
  };
}

export function toMessage(m: any) {
  return {
    id: m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    text: m.text,
    createdAt: m.created_at.toISOString(),
    isRead: false,
  };
}

// Group/channel names sit on the chat row itself. Direct chats borrow the
// other person's name — there's no "title" typed in for a 1:1 conversation.
export function toChatSummary(opts: {
  chat: any;
  me: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  myRole?: string;
}) {
  const { chat, me, lastMessage, lastMessageAt, unreadCount, myRole } = opts;

  if (chat.type === 'direct') {
    const other = chat.chat_members?.find((cm: any) => cm.user_id !== me)?.users;
    return {
      id: chat.id,
      type: 'direct',
      user: other ? toPublicUser(other) : null,
      title: null,
      avatarColor: other?.avatar_color ?? null,
      memberCount: chat.chat_members?.length ?? 2,
      myRole: myRole ?? 'member',
      lastMessage,
      lastMessageAt,
      unreadCount,
    };
  }

  return {
    id: chat.id,
    type: chat.type,
    user: null,
    title: chat.title,
    avatarColor: chat.avatar_color,
    memberCount: chat.chat_members?.length ?? 0,
    myRole: myRole ?? 'member',
    lastMessage,
    lastMessageAt,
    unreadCount,
  };
}
