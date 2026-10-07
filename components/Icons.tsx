import React from 'react';

// One inline SVG set for the whole app, so the UI does not depend on an emoji font:
// the exam room PCs render 🎓/⚠️/🔒 at different sizes and weights than the rest of the
// interface, and some of them fall back to a flat black glyph that ignores the theme.
// Every icon draws with `currentColor`, so `text-*` and `group-hover:text-*` reach it.
interface IconProps {
  className?: string;
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Builds an icon from its path data. `solid` fills the shape instead of only stroking it. */
const icon = (d: string | string[], solid = false): React.FC<IconProps> => {
  const paths = Array.isArray(d) ? d : [d];
  const Icon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => (
    <svg {...base} className={className}>
      {paths.map((p, i) => (
        <path key={i} d={p} fill={solid && i === 0 ? 'currentColor' : 'none'} />
      ))}
    </svg>
  );
  return Icon;
};

// --- Roles ---------------------------------------------------------------
/** Mortarboard — the student role. */
export const GraduationCapIcon = icon([
  'M12 3.5 2.5 8.25 12 13l9.5-4.75L12 3.5Z',
  'M6.5 10.5v4.75c0 1.66 2.46 2.75 5.5 2.75s5.5-1.09 5.5-2.75V10.5',
  'M21.5 8.25v5',
]);

/** Presentation board — the teacher role. */
export const PresentationIcon = icon([
  'M3 3.5h18',
  'M19.5 3.5v10a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-10',
  'm8.5 20.5 3.5-3.5 3.5 3.5',
  'm8.25 11.5 2.5-2.5 2 2 3-3.25',
]);

// --- Actions -------------------------------------------------------------
/** Angle brackets — a code question, whatever the language. */
export const CodeIcon = icon(['m9.5 17-5.5-5 5.5-5', 'm14.5 7 5.5 5-5.5 5']);

export const UploadIcon = icon([
  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
  'm7 8 5-5 5 5',
  'M12 3v12',
]);

export const DownloadIcon = icon([
  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
  'm7 10 5 5 5-5',
  'M12 15V3',
]);

export const PlayIcon = icon('M7 4.5v15L19.5 12 7 4.5Z', true);

export const CheckIcon = icon('m4.5 12.5 5 5 10-11');

export const CopyIcon = icon([
  'M10.5 8.5h9A1.5 1.5 0 0 1 21 10v9.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 9 19.5V10a1.5 1.5 0 0 1 1.5-1.5Z',
  'M5.5 15.5H4.5A1.5 1.5 0 0 1 3 14V4.5A1.5 1.5 0 0 1 4.5 3H14a1.5 1.5 0 0 1 1.5 1.5v1',
]);

export const PencilIcon = icon([
  'M16 4.5a1.5 1.5 0 0 1 2.12 0l1.38 1.38a1.5 1.5 0 0 1 0 2.12L8.5 19 3.5 20.5 5 15.5 16 4.5Z',
  'm14.75 5.75 3.5 3.5',
]);

export const RefreshIcon = icon([
  'M21 12a9 9 0 1 1-2.64-6.36L21 8',
  'M21 3v5h-5',
]);

export const CloseIcon = icon(['m6 6 12 12', 'm18 6-12 12']);

export const TrashIcon = icon([
  'M4 6.5h16',
  'M18.5 6.5V19a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6.5',
  'M9 6.5v-2A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v2',
  'M10.5 10.5v6',
  'M13.5 10.5v6',
]);

// --- Status --------------------------------------------------------------
export const AlertTriangleIcon = icon([
  'M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
  'M12 9.5v4',
  'M12 17h.01',
]);

export const InfoIcon = icon([
  'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z',
  'M12 11.25v5',
  'M12 7.75h.01',
]);

export const LockIcon = icon([
  'M5.5 10.5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
  'M8 10.5V7a4 4 0 0 1 8 0v3.5',
]);

export const ClockIcon = icon([
  'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z',
  'M12 7.25V12l3 1.75',
]);

export const MonitorIcon = icon([
  'M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5Z',
  'M12 16v3.5',
  'M8.5 19.5h7',
]);

export const CameraIcon = icon([
  'M4.5 7.5h3L9 5h6l1.5 2.5h3A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V9a1.5 1.5 0 0 1 1.5-1.5Z',
  'M12 9.75a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5Z',
]);

/** Broadcast dot — an exam that is open and being sat right now. */
export const LiveDotIcon = icon([
  'M12 8.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5Z',
  'M6.3 6.3a8 8 0 0 0 0 11.4',
  'M17.7 17.7a8 8 0 0 0 0-11.4',
], true);

// --- Navigation ----------------------------------------------------------
export const ChevronLeftIcon = icon('m14.5 5-7 7 7 7');
export const ChevronRightIcon = icon('m9.5 5 7 7-7 7');
export const ChevronUpIcon = icon('m6 14.5 6-6 6 6');
export const ChevronDownIcon = icon('m6 9.5 6 6 6-6');
