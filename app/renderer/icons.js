(() => {
const icons = {
  branch: '<circle cx="7" cy="5" r="2.5"/><circle cx="7" cy="19" r="2.5"/><circle cx="17" cy="6" r="2.5"/><path d="M7 7.5v9M17 8.5c0 5-10 2-10 8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10h18"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>',
  book: '<path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  drive: '<path d="m5 4-3 12v4h20v-4L19 4zM2 16h20M16 19h.01M19 19h.01"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2"/>',
  external: '<path d="M14 3h7v7m0-7L11 13M10 3H3v18h18v-7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
};
window.gitClonerIcon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.folder}</svg>`;
})();
