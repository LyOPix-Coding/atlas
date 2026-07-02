const { Ollama } = require('ollama');
const logger = require('./utils/logger');
const config = require('./utils/config');
const { SYSTEM_IDENTITY } = require('./utils/identity');

class WebSearch {
  constructor() {
    this.ollama = new Ollama({
      host: config.ollamaHost,
      headers: { Authorization: `Bearer ${config.ollamaApiKey}` },
    });
  }

  async searchAndAnswer(query) {
    try {
      logger.debug(`Web search: ${query}`);

      const searchResults = await this.ollama.webSearch({ query });
      const results = (searchResults && searchResults.results) || [];

      if (results.length === 0) {
        return { success: false, error: 'No web results found for that query' };
      }

      // Cap what we send to the model — search results can be huge.
      const trimmedResults = results.slice(0, 5).map((r) => ({
        title: r.title,
        url: r.url,
        content: (r.content || '').slice(0, 1500),
      }));

      const resultsBlock = trimmedResults
        .map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.content}`)
        .join('\n\n');

      const prompt = `Here are live web search results for the query: "${query}"

${resultsBlock}

Using these results, answer the query clearly and concisely, like you're speaking from a TTS. Don't read out URLs. If the results don't actually answer the query, say so.`;

      const response = await this.ollama.chat({
        model: config.ollamaModel,
        messages: [
          { role: 'system', content: SYSTEM_IDENTITY },
          { role: 'user', content: prompt },
        ],
      });

      logger.info(`Web search answered using ${trimmedResults.length} result(s)`);

      return {
        success: true,
        result: response.message.content.trim(),
        sources: trimmedResults.map((r) => ({ title: r.title, url: r.url })),
      };
    } catch (err) {
      logger.error(`Web search error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

module.exports = WebSearch;