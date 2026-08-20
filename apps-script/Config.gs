/**
 * SKS START Command Center - Google Apps Script server.
 *
 * The web app opens the existing workbook by ID because container-bound
 * "active spreadsheet" methods are not reliable from a deployed web app.
 */

var START_SPREADSHEET_ID = '1XFTIrKIcckrwavS-tJ5E_fReKVR3BlLtsbLUXRhto6I';
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
