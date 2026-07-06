// Placeholder AI client. Ollama has been removed from this project — this
// class is a drop-in stand-in with the same method shapes the rest of the
// codebase already calls (chat / embed / webSearch / webFetch), so nothing
// else had to change its call sites. Wire in a real backend (OpenAI,
// Anthropic, a local llama.cpp server, etc.) by filling in these methods.
//
// Every method currently throws — that's intentional. It makes it obvious
// at runtime exactly which capability still needs a real implementation,
// instead of silently returning fake data that looks like it works.

class AIProvider {
  constructor(options = {}) {
    // Keep whatever was passed in (host, apiKey, headers, ...) so a real
    // implementation has it available without changing the constructor
    // signature callers already use.
    this.options = options;
  }

  // Expected shape once implemented: { model, messages, tools } ->
  // { message: { content, tool_calls? }, prompt_eval_count, eval_count }
  async chat(_params) {
    throw new Error(
      'AIProvider.chat() is not implemented yet — plug in a real AI backend in src/utils/ai-provider.js'
    );
  }

  // Expected shape once implemented: { model, input } -> { embeddings: [[...]] }
  async embed(_params) {
    throw new Error(
      'AIProvider.embed() is not implemented yet — plug in a real embedding backend in src/utils/ai-provider.js'
    );
  }

  // Expected shape once implemented: { query } -> { results: [{ title, url, content }] }
  async webSearch(_params) {
    throw new Error(
      'AIProvider.webSearch() is not implemented yet — plug in a real web search backend in src/utils/ai-provider.js'
    );
  }

  // Expected shape once implemented: { url } -> { title, content }
  async webFetch(_params) {
    throw new Error(
      'AIProvider.webFetch() is not implemented yet — plug in a real web fetch backend in src/utils/ai-provider.js'
    );
  }
}

module.exports = { AIProvider };
