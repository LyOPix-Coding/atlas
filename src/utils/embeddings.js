const { AIProvider } = require('./ai-provider');
const logger = require('./logger');
const config = require('./config');

class EmbeddingsService {
  constructor() {
    this.ai = new AIProvider({
      host: config.aiEmbedHost,
    });
  }

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

module.exports = new EmbeddingsService();
