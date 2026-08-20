/**
 * Private, deployment-level configuration for the dormant Ask START helper.
 *
 * All values here are non-secret defaults. The API key and optional model
 * override stay in Apps Script Script Properties and are never returned to the
 * browser or included in model context.
 */

function assistantDefaults_() {
  return {
    apiUrl: 'https://api.openai.com/v1/responses',
    defaultModel: 'gpt-5.6-luna',
    promptVersion: 'start-assistant-prompt/v1',
    responseVersion: 'start-assistant-response/v1',
    responseSchemaName: 'start_assistant_response_v1',
    maxOutputTokens: 1200,
    maxInputCharacters: 48000
  };
}

function getAssistantProviderConfig_(configuredValues) {
  var configured = configuredValues || getOpenAiConfig_();
  var model = configured.model || assistantDefaults_().defaultModel;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(model)) {
    fail_('Ask START has an invalid model configuration.');
  }
  return {
    apiKey: configured.apiKey,
    model: model
  };
}

function isAssistantEnabled_() {
  return isFeatureEnabled_(START_FEATURE_PROPERTY_KEYS.aiHelper);
}

function isAssistantKnowledgeEnabled_() {
  return isFeatureEnabled_(START_FEATURE_PROPERTY_KEYS.driveKnowledge);
}
