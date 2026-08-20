function askStartAssistantWithDependencies_(profileKey, request, dependencyOverrides) {
  if (!isAssistantEnabled_()) {
    fail_('Ask START is not enabled.');
  }

  var configured = getOpenAiConfig_();
  if (!configured.apiKey) {
    fail_('Ask START is not configured yet.');
  }

  var dependencies = assistantServiceDependencies_(dependencyOverrides);
  var validatedRequest = dependencies.validateRequest(request);
  var dashboard = dependencies.getDashboardData(profileKey);
  if (!dashboard || !dashboard.viewer || !dashboard.viewer.profileKey || dashboard.viewer.isActive !== true) {
    fail_('Choose an active member profile before using Ask START.');
  }
  assistantRequireExactProjectId_(dashboard, validatedRequest.projectId);

  var knowledgeEnabled = isAssistantKnowledgeEnabled_();
  var folderConfig = knowledgeEnabled ? getDriveKnowledgeFolderConfig_() : null;
  var knowledge;
  try {
    knowledge = dependencies.collectKnowledge(validatedRequest, {
      enabled: knowledgeEnabled,
      folderConfig: folderConfig
    });
  } catch (error) {
    fail_('Ask START knowledge could not be prepared safely.');
  }
  assistantRequireKnowledgeReady_(knowledgeEnabled, knowledge);
  var knowledgeItems = knowledgeEnabled && knowledge && Array.isArray(knowledge.items)
    ? knowledge.items
    : [];
  var context = dependencies.buildContext(dashboard, validatedRequest, {
    knowledge: knowledgeItems
  });
  var sourceCatalog = dependencies.buildSourceCatalog(context);
  var providerConfig = getAssistantProviderConfig_(configured);
  var privateValues = [providerConfig.apiKey];
  if (folderConfig) {
    privateValues.push(folderConfig.sksStartFolderId, folderConfig.gsaResourceFolderId);
  }
  var providerRequest = {
    instructions: getAssistantSystemInstructions_(),
    inputText: buildAssistantInputText_(validatedRequest, context)
  };
  assertAssistantSafeModelInput_(providerRequest.inputText, privateValues);

  try {
    var modelResponse = dependencies.callProvider(providerRequest, providerConfig);
    var validatedResponse = validateAssistantModelResponse_(modelResponse, sourceCatalog, privateValues);
    return hydrateAssistantResponse_(
      validatedResponse,
      sourceCatalog,
      dashboard,
      context.scope,
      privateValues
    );
  } catch (error) {
    fail_('Ask START could not complete that request. Try again later.');
  }
}

function assistantRequireKnowledgeReady_(enabled, knowledge) {
  if (!enabled) return;
  if (!knowledge || knowledge.status !== 'ready' || !Array.isArray(knowledge.items)) {
    fail_('Ask START knowledge is enabled but is not configured for use yet.');
  }
}

function assistantRequireExactProjectId_(dashboard, projectId) {
  if (!projectId) return;
  var projects = dashboard && Array.isArray(dashboard.projects) ? dashboard.projects : [];
  var found = projects.some(function (project) {
    return project && typeof project.projectId === 'string' && project.projectId === projectId;
  });
  if (!found) fail_('That project ID was not found in the Command Center.');
}

function assistantServiceDependencies_(overrides) {
  var provided = overrides || {};
  return {
    validateRequest: provided.validateRequest || validateAssistantRequest_,
    getDashboardData: provided.getDashboardData || getDashboardData,
    collectKnowledge: provided.collectKnowledge || collectAssistantKnowledge_,
    buildContext: provided.buildContext || buildAssistantContext_,
    buildSourceCatalog: provided.buildSourceCatalog || buildAssistantSourceCatalog_,
    callProvider: provided.callProvider || callAssistantProvider_
  };
}
