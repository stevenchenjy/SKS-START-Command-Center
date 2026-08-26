/**
 * SKS START Command Center - Google Apps Script server.
 *
 * The web app opens the existing workbook by ID because container-bound
 * "active spreadsheet" methods are not reliable from a deployed web app.
 */

var START_SPREADSHEET_ID = '1XFTIrKIcckrwavS-tJ5E_fReKVR3BlLtsbLUXRhto6I';
var START_SCHOOL_TIME_ZONE = 'America/New_York';
var START_SCHEMA_VERSION = 1;
var START_WEB_VERSION = '0.4.0';
var START_WEB_BUILD = '20260826a';
var START_PROPERTY_KEYS = {
  spreadsheetId: 'START_SPREADSHEET_ID',
  coordinatorEmails: 'START_COORDINATOR_EMAILS',
  openAiApiKey: 'OPENAI_API_KEY',
  openAiModel: 'OPENAI_MODEL',
  sksStartFolderId: 'SKS_START_FOLDER_ID',
  gsaResourceFolderId: 'GSA_RESOURCE_FOLDER_ID'
};
var START_FEATURE_PROPERTY_KEYS = {
  aiHelper: 'FEATURE_AI_HELPER',
  driveKnowledge: 'FEATURE_DRIVE_KNOWLEDGE',
  decisionHelper: 'FEATURE_DECISION_HELPER',
  reporting: 'FEATURE_REPORTING'
};
var PROGRAM_SNAPSHOT_FIELD_LIMITS = {
  id: 160,
  member: 160,
  label: 300,
  shortText: 500,
  longText: 1200
};
var PROGRAM_SNAPSHOT_LINKED_METRICS_LIMIT = 12;
var PROGRAM_SNAPSHOT_SERIALIZED_CHARACTERS_LIMIT = 120000;
var START_STATUSES = ['Open', 'Doing', 'Blocked', 'Done'];
var PROJECT_STAGES = ['Idea', 'Validation', 'School Review', 'Active', 'Completed', 'Paused', 'Rejected'];
var PROJECT_STAGE_OPTIONS = PROJECT_STAGES.join(' | ');

var TASK_FIELDS = {
  taskId: ['Task ID', 'TaskID', 'ID'],
  task: ['Task', 'Task Name', 'Title', 'Action Item'],
  relatedProject: ['Related Project', 'Project', 'Project Name'],
  relatedMetric: ['Related Metric', 'Linked Metric', 'START Metric', 'Metric'],
  interestTag: ['Interest Tag', 'Interest', 'Tag', 'Category'],
  estimatedTime: ['Estimated Time', 'Time Estimate', 'Estimate'],
  dueDate: ['Due Date', 'Deadline', 'Due'],
  status: ['Status', 'Task Status'],
  claimedBy: ['Claimed By', 'ClaimedBy', 'Owner', 'Assignee', 'Assigned To'],
  lastUpdate: ['Last Update', 'Last Updated', 'Updated'],
  blocker: ['Blocker', 'Blockers', 'Current Blocker'],
  supportingLink: ['Supporting Link', 'Link', 'URL', 'Resource Link']
};

var PROJECT_FIELDS = {
  projectId: ['Project ID', 'ProjectID', 'ID'],
  projectName: ['Project Name', 'Project', 'Name', 'Title'],
  problemOpportunity: ['Problem / Opportunity', 'Problem or Opportunity', 'Problem', 'Opportunity'],
  linkedStartMetrics: ['Linked START Metrics', 'Linked Metrics', 'START Metrics', 'Metrics'],
  carbonTrack: ['Carbon Track', 'Carbon'],
  stage: ['Stage', 'Project Stage', 'Status'],
  startImpact: ['START Impact', 'Impact'],
  startDifficulty: ['START Difficulty', 'Difficulty'],
  startCost: ['START Cost', 'Cost'],
  localFeasibility: ['Local Feasibility', 'Feasibility'],
  recommendation: ['Recommendation', 'Recommended Action'],
  schoolFeedback: ['School Feedback', 'Staff Feedback', 'Feedback'],
  nextAction: ['Next Action', 'Next Step'],
  projectLead: ['Project Lead', 'Lead', 'Owner'],
  resultsLink: ['Results Link', 'Result Link', 'Link', 'URL'],
  validationEvidence: ['Validation Evidence', 'Evidence', 'Opportunity Evidence'],
  successMeasure: ['Success Measure', 'Success Measures', 'Measure of Success'],
  schoolContact: ['School Contact', 'School Contacts', 'Consulted', 'Department Consulted'],
  knownConcerns: ['Known Concerns', 'Concerns', 'Validation Concerns'],
  decisionNotes: ['Decision Notes', 'Decision Note', 'Pause / Decision Reason'],
  completedWork: ['Completed Work', 'Work Completed', 'What Was Completed'],
  observedResult: ['Observed Result', 'Observed Results', 'Result Observed']
};

var PROJECT_WORKFLOW_HEADERS = [
  { field: 'validationEvidence', canonical: 'Validation Evidence' },
  { field: 'successMeasure', canonical: 'Success Measure' },
  { field: 'schoolContact', canonical: 'School Contact' },
  { field: 'knownConcerns', canonical: 'Known Concerns' },
  { field: 'decisionNotes', canonical: 'Decision Notes' },
  { field: 'completedWork', canonical: 'Completed Work' },
  { field: 'observedResult', canonical: 'Observed Result' }
];

var UPDATE_FIELDS = {
  timestamp: ['Timestamp', 'Time', 'Date'],
  member: ['Member', 'Updated By', 'Author'],
  taskProject: ['Task / Project', 'Task or Project', 'Task Project', 'Item'],
  update: ['Update', 'Progress Update', 'Note'],
  blocker: ['Blocker', 'Blockers'],
  nextStep: ['Next Step', 'Next Action'],
  link: ['Link', 'URL', 'Supporting Link']
};

var SETTINGS_FIELDS = {
  setting: ['Setting', 'Key', 'Name'],
  value: ['Value', 'Setting Value'],
  notes: ['Notes', 'Note']
};

var MEMBER_FIELDS = {
  email: ['Email', 'Email Address', 'Google Email'],
  displayName: ['Display Name', 'Name', 'Member Name'],
  active: ['Active', 'Enabled', 'Current']
};

var METRIC_FIELDS = {
  metric: ['Metric', 'Metric Name', 'START Metric'],
  category: ['Category'],
  currentTier: ['Current Tier', 'Tier'],
  status: ['Status'],
  staffContact: ['Staff Contact', 'Contact'],
  waitingOn: ['Waiting On', 'Waiting For'],
  lastAction: ['Last Action', 'Latest Action'],
  lastUpdated: ['Last Updated', 'Updated'],
  updatedBy: ['Updated By', 'Member'],
  supportingLink: ['Supporting Link', 'Link', 'URL'],
  legacyAssignedTo: ['Legacy Assigned To', 'Assigned To']
};

function getScriptProperties_() {
  if (typeof PropertiesService === 'undefined' ||
      !PropertiesService ||
      typeof PropertiesService.getScriptProperties !== 'function') {
    return null;
  }
  return PropertiesService.getScriptProperties();
}

function getScriptProperty_(propertyName) {
  var properties = getScriptProperties_();
  if (!properties || typeof properties.getProperty !== 'function') return '';
  var value = properties.getProperty(propertyName);
  return typeof value === 'string' ? value : '';
}

function getConfiguredString_(propertyName) {
  return getScriptProperty_(propertyName).trim();
}

function getConfiguredSpreadsheetId_() {
  return getConfiguredString_(START_PROPERTY_KEYS.spreadsheetId) || START_SPREADSHEET_ID;
}

function getConfiguredCoordinatorEmails_() {
  var emails = [];
  getConfiguredString_(START_PROPERTY_KEYS.coordinatorEmails)
    .split(/[|,;\n]+/)
    .forEach(function (value) {
      var email = normalizeEmail_(value);
      if (!email || emails.indexOf(email) >= 0) return;
      emails.push(email);
    });
  return emails;
}

function isFeatureEnabled_(propertyName) {
  var supported = Object.keys(START_FEATURE_PROPERTY_KEYS).some(function (feature) {
    return START_FEATURE_PROPERTY_KEYS[feature] === propertyName;
  });
  return supported && getScriptProperty_(propertyName) === 'true';
}

function getFeatureFlags_() {
  return {
    aiHelper: isFeatureEnabled_(START_FEATURE_PROPERTY_KEYS.aiHelper),
    driveKnowledge: isFeatureEnabled_(START_FEATURE_PROPERTY_KEYS.driveKnowledge),
    decisionHelper: isFeatureEnabled_(START_FEATURE_PROPERTY_KEYS.decisionHelper),
    reporting: isFeatureEnabled_(START_FEATURE_PROPERTY_KEYS.reporting)
  };
}

function getOpenAiApiKey_() {
  return getConfiguredString_(START_PROPERTY_KEYS.openAiApiKey);
}

function getOpenAiModel_() {
  return getConfiguredString_(START_PROPERTY_KEYS.openAiModel);
}

function getOpenAiConfig_() {
  return {
    apiKey: getOpenAiApiKey_(),
    model: getOpenAiModel_()
  };
}

function getDriveKnowledgeFolderConfig_() {
  return {
    sksStartFolderId: getConfiguredString_(START_PROPERTY_KEYS.sksStartFolderId),
    gsaResourceFolderId: getConfiguredString_(START_PROPERTY_KEYS.gsaResourceFolderId)
  };
}

function isAiAssistantAvailable_() {
  return isFeatureEnabled_(START_FEATURE_PROPERTY_KEYS.aiHelper) && !!getOpenAiApiKey_();
}

function getPublicCapabilities_() {
  return {
    aiHelper: isAiAssistantAvailable_()
  };
}
