const { AIProvider } = require('./ai-provider');
const logger = require('./logger');
const config = require('./config');

// Wraps the AI provider's embedding endpoint plus the vector math needed to
// compare two pieces of text for semantic similarity. Used by
// task-executor.js to avoid generating a near-duplicate function when an
// existing learned task already covers the request.
//
// NOTE: embed() will throw until a real backend is wired into AIProvider —
// this is caught below and treated as "skip semantic comparison".
class EmbeddingsService {
  constructor() {
    // Deliberately a separate client/host from the chat client in
    // input-layer.js — embedding models are commonly run/hosted separately
    // from the main chat model.
    this.ai = new AIProvider({
      host: config.aiEmbedHost,
    });
  }

  // Returns a numeric vector for the given text, or null if embedding failed
  // (backend not implemented yet, model not available, host unreachable,
  // etc.) — callers should treat null as "skip semantic comparison" rather
  // than throwing.
  async embed(text) {
    if (!text || typeof text !== 'string') return null;

    try {
      const response = await this.ai.embed({
        model: config.aiEmbedModel,
        input: text,
      });

      const vector = response && response.embeddings && response.embeddings[0];
      if (!vector) {
        logger.warn(`Embedding call returned no vector for model "${config.aiEmbedModel}"`);
        return null;
      }
      return vector;
    } catch (err) {
      logger.warn(`Embedding error (model "${config.aiEmbedModel}"): ${err.message}`);
      return null;
    }
  }

  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// Singleton — shared across the process, one AI client for embeddings.
module.exports = new EmbeddingsService();
