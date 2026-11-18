// Small line icons for the Orb UI (stroke = currentColor, 16px grid). These are
// simple in-house icons (not Figma asset exports) used where a lightweight glyph
// is needed. size prop sets width/height.
const base = (size, extra = {}) => ({ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.33, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra });

export const IconGlobe = ({ size = 16 }) => (<svg {...base(size)}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.8 1.6 2.8 3.8 2.8 6S9.8 14.4 8 14c-1.8-.4-2.8-3.8-2.8-6S6.2 3.6 8 2z" /></svg>);
export const IconUpload = ({ size = 16 }) => (<svg {...base(size)}><path d="M8 10.5V3M5 5.5L8 2.5l3 3M3 11v1.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V11" /></svg>);
export const IconPen = ({ size = 16 }) => (<svg {...base(size)}><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" /></svg>);
export const IconFile = ({ size = 16 }) => (<svg {...base(size)}><path d="M4 2h5l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" /><path d="M9 2v3h3" /></svg>);
export const IconChevronRight = ({ size = 16 }) => (<svg {...base(size)}><path d="M6 3.5L10.5 8 6 12.5" /></svg>);
export const IconSearch = ({ size = 16 }) => (<svg {...base(size)}><circle cx="7" cy="7" r="4.5" /><path d="M13.5 13.5l-3-3" /></svg>);
export const IconPlus = ({ size = 16 }) => (<svg {...base(size)}><path d="M8 3v10M3 8h10" /></svg>);
export const IconClose = ({ size = 16 }) => (<svg {...base(size)}><path d="M4 4l8 8M12 4l-8 8" /></svg>);
export const IconMore = ({ size = 16 }) => (<svg {...base(size, { strokeWidth: 1.6 })}><circle cx="3.5" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="12.5" cy="8" r="1" /></svg>);
export const IconCheck = ({ size = 16 }) => (<svg {...base(size)}><path d="M3.5 8.5l3 3 6-7" /></svg>);
