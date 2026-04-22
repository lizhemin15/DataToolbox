const GOV_SHARED = window.GOV_SHARED || globalThis.GOV_SHARED;
const GOV_API_SECTIONS = GOV_SHARED?.GOV_API_SECTIONS || [];
const GOV_API_DOCS = GOV_SHARED?.GOV_API_DOCS || GOV_API_SECTIONS;
const governanceFunctions = GOV_SHARED?.governanceFunctions || GOV_API_DOCS;

if (typeof window !== 'undefined') {
    window.GOV_API_SECTIONS = GOV_API_SECTIONS;
    window.GOV_API_DOCS = GOV_API_DOCS;
    window.governanceFunctions = governanceFunctions;
}
if (typeof globalThis !== 'undefined') {
    globalThis.GOV_API_SECTIONS = GOV_API_SECTIONS;
    globalThis.GOV_API_DOCS = GOV_API_DOCS;
    globalThis.governanceFunctions = governanceFunctions;
}
