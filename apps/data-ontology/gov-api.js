// Get GOV_SHARED from window/globalThis (defined in gov-shared.js)
// Avoid redeclaring global identifiers that may already exist in other bundles.
const GOV_SHARED_REF = window.GOV_SHARED || globalThis.GOV_SHARED || {};
const GOV_API_SECTIONS_LOCAL = GOV_SHARED_REF.GOV_API_SECTIONS || [];
const GOV_API_DOCS_LOCAL = GOV_SHARED_REF.GOV_API_DOCS || GOV_API_SECTIONS_LOCAL;
const governanceFunctionsLocal = GOV_SHARED_REF.governanceFunctions || GOV_API_DOCS_LOCAL;
