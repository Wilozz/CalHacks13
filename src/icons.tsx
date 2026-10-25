// Inline stroke icons for the call controls; aria-hidden because every button carries its own label.
const paths = {
  mic: <><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/></>,
  micOff: <><path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.7 2.5M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.7 5.9M12 18v3M3 3l18 18"/></>,
  video: <><rect x="2" y="6" width="14" height="12" rx="3"/><path d="M16 10l6-3v10l-6-3z"/></>,
  videoOff: <><path d="M16 16v-1l6 3V7l-6 3V9a3 3 0 0 0-3-3H8M2 9v6a3 3 0 0 0 3 3h8M3 3l18 18"/></>,
  flip: <path d="M4 9h14l-3-3M20 15H6l3 3"/>,
  share: <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3.5"/>,
  close: <path d="M6 6l12 12M18 6L6 18"/>,
  scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/></>,
  scanOff: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M3 3l18 18"/></>,
  hand: <path d="M12 21.5 8.5 19.5 6 16.5 4.5 13.5 3.5 10.5M12 21.5 9 10 8.4 6.1 8 3.5M12 9.4V2M14.8 10l.6-4.5.4-2.3M12 21.5l5.2-10.4 1.2-3 .8-2.2M9 10l3-.6 2.8.6 2.4 1.1"/>,
  end: <path fill="currentColor" stroke="none" d="M2.5 14.5c5-4.7 14-4.7 19 0l-2.3 2.8-4-1.2v-2.4a10 10 0 0 0-6.4 0v2.4l-4 1.2z"/>,
};
export function Icon({ name, size = 22 }: { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
