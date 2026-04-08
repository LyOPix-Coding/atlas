const IntentClassifier = require('./models/intent-classifier');
const logger = require('./utils/logger');

class IntentProcessor {
  constructor() {
    this.classifier = new IntentClassifier();
  }

  async process(input, requestId) {
    try {
      logger.debug(`Processing intent: ${input}`);

      // Run ML classifier
      const classification = this.classifier.classify(input);

      logger.debug(`Classification: ${JSON.stringify(classification)}`);

      // Validate: Is the task legal/safe?
      if (!this.isLegal(classification.task)) {
        return {
          approved: false,
          reason: `Task "${classification.task}" is not permitted`,
        };
      }

      // Validate: Is it feasible?
      if (!this.isFeasible(classification.task, classification.params)) {
        return {
          approved: false,
          reason: `Task "${classification.task}" is not feasible with given parameters`,
        };
      }

      return {
        approved: true,
        task: classification.task,
        params: classification.params,
      };
    } catch (err) {
      logger.error(`Intent processing error: ${err.message}`);
      return {
        approved: false,
        reason: 'Intent processing failed',
      };
    }
  }

  isLegal(task) {
    // Blacklist: prevent certain dangerous tasks
    const blacklist = ['delete_all', 'format_drive', 'rm_rf', 'fork_bomb'];
    return !blacklist.includes(task.toLowerCase());
  }

  isFeasible(task, params) {
    // Example: check if required params exist
    if (task === 'http_request' && (!params.url || !params.method)) {
      return false;
    }
    if (task === 'file_read' && !params.path) {
      return false;
    }
    return true;
  }
}

module.exports = IntentProcessor;