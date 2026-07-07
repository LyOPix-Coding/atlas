const MAX_HISTORY_MESSAGES = 20;
const CONVERSATION_TTL_MS = 1000 * 60 * 60;

class ConversationStore {
  constructor() {
    this.conversations = new Map();
  }

  get(requestId) {
    const entry = this.conversations.get(requestId);
    if (!entry) return null;

    if (Date.now() - entry.updatedAt > CONVERSATION_TTL_MS) {
      this.conversations.delete(requestId);
      return null;
    }

    return entry.messages;
  }

  save(requestId, messages) {
    const trimmed =
      messages.length > MAX_HISTORY_MESSAGES
        ? [messages[0], ...messages.slice(-(MAX_HISTORY_MESSAGES - 1))]
        : messages;

    this.conversations.set(requestId, { messages: trimmed, updatedAt: Date.now() });
  }
}

module.exports = new ConversationStore();