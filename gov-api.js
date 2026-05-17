// Get GOV_SHARED from window/globalThis (defined in gov-shared.js)
// Use window-scoped cache so repeated script evaluation does not crash on redeclaration.
var GOV_SHARED_REF = window.__GOV_SHARED_REF__ || (window.__GOV_SHARED_REF__ = (window.GOV_SHARED || globalThis.GOV_SHARED || {}));
var GOV_API_SECTIONS_LOCAL = GOV_SHARED_REF.GOV_API_SECTIONS || [];
var GOV_API_DOCS_LOCAL = GOV_SHARED_REF.GOV_API_DOCS || GOV_API_SECTIONS_LOCAL;
var governanceFunctionsLocal = GOV_SHARED_REF.governanceFunctions || GOV_API_DOCS_LOCAL;
