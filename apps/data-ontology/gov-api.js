// Get GOV_SHARED from window/globalThis (defined in gov-shared.js)
// Do NOT redeclare GOV_SHARED - it's already defined in gov-shared.js
var GOV_API_SECTIONS = (window.GOV_SHARED || globalThis.GOV_SHARED || {}).GOV_API_SECTIONS || [];
var GOV_API_DOCS = (window.GOV_SHARED || globalThis.GOV_SHARED || {}).GOV_API_DOCS || GOV_API_SECTIONS;
var governanceFunctions = (window.GOV_SHARED || globalThis.GOV_SHARED || {}).governanceFunctions || GOV_API_DOCS;
