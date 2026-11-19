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
export const IconLock = ({ size = 16 }) => (<svg {...base(size)}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>);
export const IconKey = ({ size = 16 }) => (<svg {...base(size)}><circle cx="5.5" cy="10.5" r="2.5" /><path d="M7.3 8.7L13 3M11 4.5l1.6 1.6" /></svg>);
export const IconRefresh = ({ size = 16 }) => (<svg {...base(size)}><path d="M12.8 8a4.8 4.8 0 11-1.4-3.4" /><path d="M12.8 2.6V5.2H10.2" /></svg>);
export const IconPlay = ({ size = 16 }) => (<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.3l7.2 4.4a.3.3 0 010 .6L5 12.7a.3.3 0 01-.5-.3V3.6a.3.3 0 01.5-.3z" /></svg>);
export const IconSend = ({ size = 16 }) => (<svg {...base(size)}><path d="M14 2L2 7.2l4.8 1.9M14 2l-4 12-2.2-5M14 2L6.8 9.1" /></svg>);
export const IconArrowRight = ({ size = 16 }) => (<svg {...base(size)}><path d="M3 8h9.5M9 4.5L12.5 8 9 11.5" /></svg>);
export const IconCalendar = ({ size = 16 }) => (<svg {...base(size)}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" /></svg>);
export const IconPhone = ({ size = 16 }) => (<svg {...base(size)}><path d="M5.3 2.6l1.3 2.8-1.1 1.1a7 7 0 003 3l1.1-1.1 2.8 1.3v2.1a1.4 1.4 0 01-1.5 1.4A10.6 10.6 0 012.6 4.1 1.4 1.4 0 014 2.6z" /></svg>);
export const IconMail = ({ size = 16 }) => (<svg {...base(size)}><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2.6 4.8L8 8.8l5.4-4" /></svg>);
export const IconUser = ({ size = 16 }) => (<svg {...base(size)}><circle cx="8" cy="5.3" r="2.6" /><path d="M3.3 13a4.7 4.7 0 019.4 0" /></svg>);
export const IconLink = ({ size = 16 }) => (<svg {...base(size)}><path d="M6.6 9.4l2.8-2.8M7.2 4.6l1-1a2.4 2.4 0 013.4 3.4l-1 1M8.8 11.4l-1 1a2.4 2.4 0 01-3.4-3.4l1-1" /></svg>);
export const IconChat = ({ size = 16 }) => (<svg {...base(size)}><path d="M3 11.5V4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v4A1.5 1.5 0 0111.5 10H6l-3 2.5z" /></svg>);
export const IconGrid = ({ size = 16 }) => (<svg {...base(size)}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></svg>);
export const IconDrag = ({ size = 16 }) => (<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1" /><circle cx="6" cy="8" r="1" /><circle cx="6" cy="12" r="1" /><circle cx="10" cy="4" r="1" /><circle cx="10" cy="8" r="1" /><circle cx="10" cy="12" r="1" /></svg>);
export const IconFlag = ({ size = 16 }) => (<svg {...base(size)}><path d="M3.5 14V2.5M3.5 3h8l-1.6 2.5L11.5 8h-8" /></svg>);
export const IconSpark = ({ size = 16 }) => (<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5l1.4 4.1 4.1 1.4-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z" /></svg>);

