
class AIProvider {
  constructor(options = {}) {
    this.options = options;
  }

  async chat(_params) {
    throw new Error(
      'AIProvider.chat() is not implemented yet — plug in a real AI backend in src/utils/ai-provider.js'
    );
  }

  async embed(_params) {
    throw new Error(
      'AIProvider.embed() is not implemented yet — plug in a real embedding backend in src/utils/ai-provider.js'
    );
  }

  async webSearch(_params) {
    throw new Error(
      'AIProvider.webSearch() is not implemented yet — plug in a real web search backend in src/utils/ai-provider.js'
    );
  }

  async webFetch(_params) {
    throw new Error(
      'AIProvider.webFetch() is not implemented yet — plug in a real web fetch backend in src/utils/ai-provider.js'
    );
  }
}

module.exports = { AIProvider };
