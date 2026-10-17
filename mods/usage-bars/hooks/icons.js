// Small line icons for the session-tokens row, drawn as 12px SVGs on the
// desktop; the terminal shows each one's glyph instead

export const ICONS = {
  // An arrow down into a tray: tokens sent in
  input: {
    alt: 'Input tokens',
    color: '#58A6FF',
    glyph: '⇣',
    paths: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  },
  // An arrow up out of a tray: tokens generated
  output: {
    alt: 'Output tokens',
    color: '#3FB950',
    glyph: '⇡',
    paths: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  },
  // A banknote: what the session has cost
  cost: {
    alt: 'Cost',
    color: '#E3B341',
    glyph: '$',
    paths: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01"/><path d="M18 12h.01"/>',
  },
}

export function iconSvg(name) {
  const icon = ICONS[name]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${icon.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon.paths}</svg>`
}
