import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base(paths: React.ReactNode) {
  return function Icon({ size = 18, ...rest }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconSettings = base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
export const IconHelp = base(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.1-2.4 3.8" /><path d="M12 17h.01" /></>);
export const IconClose = base(<path d="M6 6l12 12M18 6 6 18" />);
export const IconCheck = base(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconArrowLeft = base(<path d="M19 12H5m6-6-6 6 6 6" />);
export const IconArrowRight = base(<path d="M5 12h14m-6-6 6 6-6 6" />);
export const IconShield = base(<><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>);
export const IconLock = base(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const IconInfo = base(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconWifi = base(<><path d="M2 8.8a15 15 0 0 1 20 0" /><path d="M5 12.4a10 10 0 0 1 14 0" /><path d="M8.5 15.9a5 5 0 0 1 7 0" /><path d="M12 19.5h.01" /></>);
export const IconHotspot = base(<><circle cx="12" cy="12" r="2" /><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></>);
export const IconPhone = base(<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>);
export const IconSlides = base(<><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v3M8.5 20.5h7" /><path d="m10 8.5 4 2-4 2z" /></>);
export const IconTimer = base(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9.5 2.5h5" /></>);
export const IconLaser = base(<><circle cx="12" cy="12" r="3.5" fill="currentColor" /><circle cx="12" cy="12" r="8.5" opacity=".45" /></>);
export const IconCopy = base(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>);
export const IconRefresh = base(<><path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v3.5h3.5" /><path d="M4 13a8 8 0 0 0 14.9 3.5M20 20v-3.5h-3.5" /></>);
export const IconTrash = base(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></>);
export const IconKeyboard = base(<><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>);
export const IconMonitor = base(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>);
export const IconPlay = base(<path d="M7 5v14l11-7z" />);
export const IconPause = base(<><path d="M8 5v14M16 5v14" /></>);
export const IconAlert = base(<><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>);
export const IconNet = base(<><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-2h12v2" /></>);

// ------------------------------------------------------------------ SlimKit
export const IconFolder = base(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const IconFolderTree = base(<><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H8l1.5 1.5h3A1.5 1.5 0 0 1 14 7v1.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 3 8.5z" /><path d="M6 10v8h4M6 14h4" /><rect x="10" y="12" width="11" height="4" rx="1.2" /><rect x="10" y="16.5" width="11" height="4" rx="1.2" /></>);
export const IconRename = base(<><path d="M4 7h10M4 12h7M4 17h6" /><path d="m14.5 18.5 1-3.5 5-5a1.4 1.4 0 0 1 2 2l-5 5z" /></>);
export const IconImage = base(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></>);
export const IconResize = base(<><rect x="3" y="9" width="12" height="12" rx="2" /><path d="M14 3h7v7M21 3l-7 7" /></>);
export const IconCalendar = base(<><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8.5 14h2M13.5 14h2M8.5 17h2" /></>);
export const IconSend = base(<><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M12 15V7m-3 3 3-3 3 3" /></>);
export const IconReceive = base(<><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M12 7v8m-3-3 3 3 3-3" /></>);
export const IconSort = base(<><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H8l1.5 1.5h4A1.5 1.5 0 0 1 15 8v1" /><path d="M3 6.5V17a2 2 0 0 0 2 2h5" /><path d="M14 13h7M14 16.5h5M14 20h3" /></>);
export const IconPdf = base(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M8.5 16.5v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5M13 12.5v4h.8a2 2 0 0 0 0-4z" /></>);
export const IconCopies = base(<><rect x="3" y="7" width="11" height="14" rx="2" /><rect x="10" y="3" width="11" height="14" rx="2" /><path d="M13.5 10h4M13.5 13h4" /></>);
export const IconFlatten = base(<><path d="M4 4h16M4 20h16" /><path d="M12 7v10m-3.5-3.5L12 17l3.5-3.5" /></>);
export const IconBroom = base(<><path d="M19 3 11 11" /><path d="M11.5 10.5 6 12l-3 9 9-3 1.5-5.5z" /><path d="M7 17l2-2" /></>);
export const IconPie = base(<><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>);
export const IconList = base(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></>);
export const IconHash = base(<path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18" />);
export const IconFilePlus = base(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 11v6M9 14h6" /></>);
export const IconFolderPlus = base(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 10v6M9 13h6" /></>);
export const IconLink = base(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const IconHistory = base(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>);
export const IconUndo = base(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
export const IconBolt = base(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />);
export const IconPlus = base(<path d="M12 5v14M5 12h14" />);
export const IconMouse = base(<><rect x="6" y="3" width="12" height="18" rx="6" /><path d="M12 7v4" /></>);
export const IconUp = base(<path d="m6 15 6-6 6 6" />);
export const IconDown = base(<path d="m6 9 6 6 6-6" />);
export const IconEye = base(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconStop = base(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const IconUpload = base(<><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>);
export const IconSparkle = base(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></>);
export const IconFile = base(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>);
export const IconVideo = base(<><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>);
export const IconMusic = base(<><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>);
export const IconArchive = base(<><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></>);
