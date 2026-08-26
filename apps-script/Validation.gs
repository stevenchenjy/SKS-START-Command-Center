function objectInput_(value, label) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    fail_(label + ' details are required.');
  }
  return value;
}

function hasOwn_(object, property) {
  return Object.prototype.hasOwnProperty.call(object || {}, property);
}

function singleLineText_(value, label, maxLength, required) {
  var text = validateText_(value, label, maxLength, required);
  if (/[\r\n]/.test(text)) fail_(label + ' must be a single line.');
  return text;
}

function validateChoice_(value, label, choices) {
  var key = normalizeHeader_(value);
  if (!choices[key]) {
    fail_(label + ' is not supported.');
  }
  return choices[key];
}

function validateText_(value, label, maxLength, required) {
  var text = string_(value).trim();
  if (required && !text) fail_(label + ' is required.');
  if (text.length > maxLength) fail_(label + ' must be ' + maxLength + ' characters or fewer.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    fail_(label + ' contains unsupported control characters.');
  }
  return text;
}

function literalSheetText_(value) {
  var text = string_(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function validateDueDate_(value, label) {
  var clean = singleLineText_(value, label || 'Due date', 10, false);
  if (!clean) return '';
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (!match) fail_((label || 'Due date') + ' must use YYYY-MM-DD.');
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail_((label || 'Due date') + ' must be a real calendar date.');
  }
  return clean;
}

function string_(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value);
}
