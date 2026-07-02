const MAX_HISTORY_MESSAGES = 20; // includes leading system message
const CONVERSATION_TTL_MS = 1000 * 60 * 60; // 1 hour of inactivity

class ConversationStore {
  constructor() {
    this.conversations = new Map(); // requestId -> { messages, updatedAt }
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
    // Keep the leading system message, trim the rest so history can't grow unbounded.
    const trimmed =
      messages.length > MAX_HISTORY_MESSAGES
        ? [messages[0], ...messages.slice(-(MAX_HISTORY_MESSAGES - 1))]
        : messages;

    this.conversations.set(requestId, { messages: trimmed, updatedAt: Date.now() });
  }

  clear(requestId) {
    this.conversations.delete(requestId);
  }
}

// Singleton — shared across the process.
module.exports = new ConversationStore();