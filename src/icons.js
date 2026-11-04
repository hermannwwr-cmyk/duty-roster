// Line icons for the tab bar (shown along the bottom on phones). Plain SVG in currentColor.
const svg = d => `<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

export const TAB_ICONS = {
  today: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2"/>'),
  roster: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M15.5 14.6c2.3 0 4.1 1.5 4.8 4.4"/>'),
  leave: svg('<path d="M10.5 3.5 13 10l6.5 2.2a1.2 1.2 0 0 1 0 2.3L13 16.7l-2.5 3.8h-1.6l1-4.2-4.6-1.6-2 1.6H2.2l1.3-3.1-1.3-3h1.1l2 1.6 4.6-1.6-1-4.2h1.6z"/>'),
  team: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>')
};

/** A tab's contents: its icon, its full label, and a short label for the phone tab bar. */
export const tabInner = (id, label, short = label) =>
  `${TAB_ICONS[id] || ''}<span class="tab-long">${label}</span><span class="tab-short" aria-hidden="true">${short}</span>`;
