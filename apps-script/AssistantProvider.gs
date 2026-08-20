function callAssistantProvider_(providerRequest, configuration, fetcher) {
  var defaults = assistantDefaults_();
  var payload = buildAssistantResponsesPayload_(providerRequest, configuration);
  var fetchFunction = fetcher || function (url, options) {
    return UrlFetchApp.fetch(url, options);
  };
  var httpResponse;
  try {
    httpResponse = fetchFunction(defaults.apiUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + configuration.apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (error) {
    assistantProviderFailure_();
  }

  var statusCode;
  var responseText;
  try {
    statusCode = Number(httpResponse.getResponseCode());
    responseText = httpResponse.getContentText();
  } catch (error) {
    assistantProviderFailure_();
  }
  if (!isFinite(statusCode) || statusCode < 200 || statusCode >= 300) assistantProviderFailure_();

  var response;
  try {
    response = JSON.parse(responseText);
  } catch (error) {
    assistantProviderFailure_();
  }
  if (!response || response.status !== 'completed' || response.error || response.incomplete_details) {
    assistantProviderFailure_();
  }
  return extractAssistantOutputObject_(response);
}

function buildAssistantResponsesPayload_(providerRequest, configuration) {
  var defaults = assistantDefaults_();
  if (!providerRequest || typeof providerRequest.instructions !== 'string' ||
      typeof providerRequest.inputText !== 'string') {
    assistantProviderFailure_();
  }
  if (!configuration || !configuration.apiKey || !configuration.model) {
    assistantProviderFailure_();
  }
  return {
    model: configuration.model,
    instructions: providerRequest.instructions,
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: providerRequest.inputText
      }]
    }],
    text: {
      format: {
        type: 'json_schema',
        name: defaults.responseSchemaName,
        strict: true,
        schema: buildAssistantResponseJsonSchema_()
      }
    },
    max_output_tokens: defaults.maxOutputTokens,
    store: false
  };
}

function extractAssistantOutputObject_(response) {
  if (!Array.isArray(response.output)) assistantProviderFailure_();
  var outputTexts = [];
  response.output.forEach(function (item) {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) return;
    item.content.forEach(function (content) {
      if (content && content.type === 'refusal') assistantProviderFailure_();
      if (content && content.type === 'output_text' && typeof content.text === 'string') {
        outputTexts.push(content.text);
      }
    });
  });
  if (outputTexts.length !== 1 || !outputTexts[0].trim()) assistantProviderFailure_();
  try {
    return JSON.parse(outputTexts[0]);
  } catch (error) {
    assistantProviderFailure_();
  }
}

function assistantProviderFailure_() {
  fail_('Ask START could not complete that request. Try again later.');
}
