/**
 * Illustrationen im SlimKit-Stil: weiche Formen, Ordner in Blau, Fotos mit Farbverlauf, Handy.
 * Alles als SVG (gestochen scharf, passt sich hell/dunkel an).
 */
import { useId, type ReactNode } from 'react';
import { getLang } from '../i18n';

const isDe = () => getLang() === 'de';

type P = { x: number; y: number; w: number; h: number };

function Folder({ x, y, w, h, open, label, glow }: P & { open?: boolean; label?: string; glow?: boolean }) {
  const r = Math.min(6, h / 5);
  const t = Math.max(5, h * 0.16);
  const tab = w * 0.32;
  const body = `M${x} ${y + r}q0 ${-r} ${r} ${-r}h${tab}l${t} ${t}h${w - 2 * r - tab - t}q${r} 0 ${r} ${r}v${h - t - 2 * r}q0 ${r} ${-r} ${r}h${-(w - 2 * r)}q${-r} 0 ${-r} ${-r}z`;
  return (
    <g>
      {glow && <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={r + 4} fill="#2dd4bf" opacity="0.25" />}
      <path d={body} fill="#3d8ef0" />
      {open && <rect x={x + w * 0.1} y={y + t + 1} width={w * 0.8} height={h * 0.45} rx="2" fill="#fff" opacity="0.9" />}
      <rect x={x} y={y + t + (open ? h * 0.22 : 3)} width={w} height={h - t - (open ? h * 0.22 : 3)} rx={r} fill="#6db3fb" />
      {label && (
        <text x={x + w / 2} y={y + h * 0.72} textAnchor="middle" fontSize={Math.min(11, h * 0.3)} fontWeight="700" fill="#fff" fontFamily="-apple-system, Segoe UI, sans-serif">
          {label}
        </text>
      )}
    </g>
  );
}

function Photo({ x, y, w, h, hue = 0, rot = 0 }: P & { hue?: number; rot?: number }) {
  const id = useId().replace(/:/g, '');
  const skies = [
    ['#ffb38a', '#ff6f91'],
    ['#7dd3fc', '#3b82f6'],
    ['#fde68a', '#f59e0b'],
    ['#c4b5fd', '#8b5cf6'],
    ['#86efac', '#14b8a6'],
  ][hue % 5];
  return (
    <g transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}>
      <defs>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={skies[0]} />
          <stop offset="1" stopColor={skies[1]} />
        </linearGradient>
        <clipPath id={`c${id}`}>
          <rect x={x} y={y} width={w} height={h} rx="4" />
        </clipPath>
      </defs>
      <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx="5.5" fill="#fff" filter="drop-shadow(0 2px 3px rgba(0,0,0,.18))" />
      <g clipPath={`url(#c${id})`}>
        <rect x={x} y={y} width={w} height={h} fill={`url(#s${id})`} />
        <circle cx={x + w * 0.72} cy={y + h * 0.3} r={Math.min(w, h) * 0.12} fill="#fff" opacity="0.9" />
        <path d={`M${x} ${y + h}L${x + w * 0.35} ${y + h * 0.5}L${x + w * 0.55} ${y + h * 0.72}L${x + w * 0.72} ${y + h * 0.58}L${x + w} ${y + h}z`} fill="#fff" opacity="0.55" />
      </g>
    </g>
  );
}

function Phone({ x, y, w, h, children }: P & { children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={w * 0.18} fill="#1f2430" />
      <rect x={x + 3} y={y + 6} width={w - 6} height={h - 12} rx={w * 0.12} fill="#f8fafc" />
      <rect x={x + w / 2 - 6} y={y + 2.5} width="12" height="2" rx="1" fill="#3b4252" />
      {children}
    </g>
  );
}

function Laptop({ x, y, w, h, children }: P & { children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="5" fill="#1f2430" />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} rx="2.5" fill="#f8fafc" />
      <path d={`M${x - 10} ${y + h + 1}h${w + 20}l-5 6h${-(w + 10)}z`} fill="#9aa4b6" />
      {children}
    </g>
  );
}

function Arrow({ x1, x2, y, dashed }: { x1: number; x2: number; y: number; dashed?: boolean }) {
  return (
    <g stroke="#14b8a6" strokeWidth="3" strokeLinecap="round" fill="none">
      <path d={`M${x1} ${y}H${x2}`} strokeDasharray={dashed ? '1 6' : undefined} />
      <path d={`M${x2 - 7} ${y - 7}L${x2} ${y}L${x2 - 7} ${y + 7}`} strokeLinejoin="round" />
    </g>
  );
}

function Doc({ x, y, w, h, color = '#ef4444', label = 'PDF' }: P & { color?: string; label?: string }) {
  return (
    <g filter="drop-shadow(0 2px 4px rgba(0,0,0,.15))">
      <path d={`M${x} ${y + 4}q0 -4 4 -4h${w * 0.62}l${w * 0.38 - 4} ${w * 0.38 - 4}v${h - w * 0.38}q0 4 -4 4h${-(w - 8)}q-4 0 -4 -4z`} fill="#fff" />
      <path d={`M${x + w * 0.62 + 4} ${y}v${w * 0.3}q0 4 4 4h${w * 0.3 - 4}`} fill="#e5e7eb" />
      <rect x={x + w * 0.14} y={y + h * 0.55} width={w * 0.72} height={h * 0.22} rx="3" fill={color} />
      <text x={x + w / 2} y={y + h * 0.71} textAnchor="middle" fontSize={h * 0.15} fontWeight="800" fill="#fff" fontFamily="-apple-system, Segoe UI, sans-serif">
        {label}
      </text>
    </g>
  );
}

function Frame({ color, children, w = 200, h = 120 }: { color: string; children: ReactNode; w?: number; h?: number }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="art" aria-hidden="true">
      <rect width={w} height={h} rx="16" fill={color} opacity="0.13" />
      {children}
    </svg>
  );
}

const Label = ({ x, y, children, color = '#475569', size = 9, anchor = 'middle', weight = 700 }: { x: number; y: number; children: ReactNode; color?: string; size?: number; anchor?: 'start' | 'middle' | 'end'; weight?: number }) => (
  <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={color} fontFamily="-apple-system, Segoe UI, sans-serif" className={color === '#475569' ? 'art-label' : undefined}>
    {children}
  </text>
);

// ------------------------------------------------------------------ Aufgaben
export function ArtStructure() {
  return (
    <Frame color="#14b8a6">
      <Folder x={22} y={34} w={58} h={46} open />
      <Photo x={30} y={22} w={20} h={15} hue={0} rot={-10} />
      <Photo x={50} y={20} w={20} h={15} hue={1} rot={8} />
      <Label x={51} y={98}>2025</Label>
      <Arrow x1={90} x2={112} y={57} />
      <Folder x={122} y={34} w={58} h={46} glow />
      <Label x={151} y={98} color="#0d9488">2026</Label>
    </Frame>
  );
}
export function ArtImages() {
  return (
    <Frame color="#f97316">
      <Photo x={20} y={26} w={64} h={48} hue={2} />
      <Label x={52} y={96}>4,2 MB</Label>
      <Arrow x1={94} x2={118} y={50} />
      <Photo x={130} y={36} w={40} h={30} hue={2} />
      <Label x={150} y={96} color="#ea580c">
        320 KB
      </Label>
    </Frame>
  );
}
export function ArtSend() {
  return (
    <Frame color="#22c55e">
      <Laptop x={20} y={26} w={74} h={50}>
        <Photo x={36} y={36} w={20} h={15} hue={3} />
        <Photo x={60} y={40} w={20} h={15} hue={1} />
      </Laptop>
      <Arrow x1={104} x2={130} y={52} dashed />
      <Phone x={140} y={18} w={42} h={82}>
        <Photo x={148} y={34} w={26} h={19} hue={3} />
        <Photo x={148} y={58} w={26} h={19} hue={1} />
      </Phone>
    </Frame>
  );
}
export function ArtReceive() {
  return (
    <Frame color="#10b981">
      <Phone x={22} y={18} w={42} h={82}>
        <Photo x={30} y={30} w={11} h={10} hue={0} />
        <Photo x={44} y={30} w={11} h={10} hue={2} />
        <Photo x={30} y={44} w={11} h={10} hue={4} />
        <Photo x={44} y={44} w={11} h={10} hue={1} />
        <rect x={30} y={70} width={26} height={9} rx="4.5" fill="#14b8a6" />
      </Phone>
      <Arrow x1={76} x2={104} y={58} dashed />
      <Folder x={116} y={34} w={62} h={50} open />
      <Photo x={128} y={24} w={22} h={16} hue={0} rot={-8} />
      <Photo x={148} y={25} w={22} h={16} hue={4} rot={7} />
    </Frame>
  );
}
export function ArtRename() {
  const v = isDe() ? 'Urlaub' : 'Holiday';
  const rows = [
    ['IMG_4821.jpg', `${v} 01.jpg`],
    ['IMG_4822.jpg', `${v} 02.jpg`],
    ['IMG_4830.jpg', `${v} 03.jpg`],
  ];
  return (
    <Frame color="#6366f1">
      {rows.map(([a, b], i) => (
        <g key={i}>
          <rect x={14} y={24 + i * 26} width={74} height={18} rx="5" fill="#fff" opacity="0.85" />
          <Label x={20} y={36 + i * 26} anchor="start" size={8.5} weight={600} color="#94a3b8">
            {a}
          </Label>
          <path d={`M95 ${33 + i * 26}h12`} stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
          <path d={`M103 ${29 + i * 26}l4 4-4 4`} stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <rect x={114} y={24 + i * 26} width={74} height={18} rx="5" fill="#fff" />
          <Label x={120} y={36 + i * 26} anchor="start" size={8.5} color="#4f46e5">
            {b}
          </Label>
        </g>
      ))}
    </Frame>
  );
}
export function ArtSort() {
  return (
    <Frame color="#a855f7">
      <Photo x={18} y={30} w={22} h={16} hue={0} rot={-14} />
      <Photo x={34} y={52} w={22} h={16} hue={1} rot={10} />
      <Photo x={22} y={72} w={22} h={16} hue={3} rot={-4} />
      <Photo x={46} y={28} w={22} h={16} hue={2} rot={6} />
      <Arrow x1={78} x2={100} y={60} />
      <Folder x={110} y={20} w={34} h={26} label="Jan" />
      <Folder x={150} y={20} w={34} h={26} label="Feb" />
      <Folder x={110} y={56} w={34} h={26} label={isDe() ? 'Mär' : 'Mar'} />
      <Folder x={150} y={56} w={34} h={26} label="Apr" />
    </Frame>
  );
}
export function ArtPdf() {
  return (
    <Frame color="#ef4444">
      <Photo x={22} y={22} w={36} h={27} hue={4} rot={-8} />
      <Photo x={30} y={44} w={36} h={27} hue={1} rot={5} />
      <Photo x={24} y={66} w={36} h={27} hue={2} rot={-3} />
      <Arrow x1={82} x2={108} y={58} />
      <Doc x={124} y={22} w={50} h={70} />
    </Frame>
  );
}
export function ArtDates() {
  return (
    <Frame color="#0ea5e9">
      <Photo x={26} y={26} w={62} h={46} hue={1} />
      <g transform="translate(108 24)">
        <rect width="64" height="64" rx="12" fill="#fff" filter="drop-shadow(0 2px 4px rgba(0,0,0,.15))" />
        <path d="M0 12a12 12 0 0 1 12-12h40a12 12 0 0 1 12 12v8H0z" fill="#0ea5e9" />
        <Label x={32} y={15} color="#fff" size={9}>
          JUL
        </Label>
        <Label x={32} y={50} color="#0f172a" size={26} weight={800}>
          14
        </Label>
      </g>
      <Label x={57} y={92} size={8.5}>
        IMG_20250714
      </Label>
    </Frame>
  );
}

/** Großes Bild für die Ablagefläche auf der Startseite */
export function ArtDrop() {
  return (
    <svg viewBox="0 0 220 130" className="art drop-art" aria-hidden="true">
      <Folder x={62} y={46} w={96} h={72} open />
      <Photo x={66} y={20} w={38} h={28} hue={0} rot={-14} />
      <Photo x={112} y={16} w={38} h={28} hue={1} rot={10} />
      <Doc x={92} y={6} w={30} h={40} color="#6366f1" label="DOC" />
      <g stroke="#14b8a6" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.8">
        <path d="M30 40l-8-6M28 66H18M32 92l-8 6" />
        <path d="M190 40l8-6M192 66h10M188 92l8 6" />
      </g>
    </svg>
  );
}

/** Rechtsklick-Menü als Bild (Mac: Schnellaktionen, Windows: Untermenü) */
export function ArtRightClick({ mac }: { mac: boolean }) {
  const de = isDe();
  const items = mac
    ? de ? ['Öffnen', 'Informationen', 'Umbenennen', 'Schnellaktionen'] : ['Open', 'Get Info', 'Rename', 'Quick Actions']
    : de ? ['Öffnen', 'Kopieren', 'Umbenennen', 'SlimKit'] : ['Open', 'Copy', 'Rename', 'SlimKit'];
  const sub = mac
    ? de ? ['SlimKit …', 'SlimKit: Ordnerstruktur', 'SlimKit: Fotos'] : ['SlimKit …', 'SlimKit: Folder structure', 'SlimKit: Photos']
    : de ? ['SlimKit öffnen …', 'Ordnerstruktur kopieren', 'Fotos kleiner machen'] : ['Open SlimKit …', 'Copy folder structure', 'Make photos smaller'];
  return (
    <svg viewBox="0 0 240 130" className="art" aria-hidden="true">
      <rect width="240" height="130" rx="16" fill="#14b8a6" opacity="0.1" />
      <Folder x={18} y={22} w={42} h={32} />
      <Label x={39} y={68} size={8} color="#475569">
        {isDe() ? 'Fotos 2025' : 'Photos 2025'}
      </Label>
      <path d="M52 50l10 26 4-10 10-2z" fill="#111827" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      <g filter="drop-shadow(0 4px 8px rgba(0,0,0,.18))">
        <rect x={72} y={22} width={78} height={84} rx="8" fill="#fff" />
        {items.map((it, i) => (
          <g key={it}>
            {i === 3 && <rect x={76} y={26 + i * 19} width={70} height={17} rx="4" fill="#3b82f6" />}
            <Label x={82} y={38 + i * 19} anchor="start" size={8} weight={i === 3 ? 700 : 500} color={i === 3 ? '#fff' : '#334155'}>
              {it}
            </Label>
          </g>
        ))}
        <rect x={152} y={78} width={82} height={62 - 14} rx="8" fill="#fff" />
        {sub.map((it, i) => (
          <g key={it}>
            {i === 0 && <rect x={156} y={82} width={74} height={14} rx="4" fill="#14b8a6" opacity="0.18" />}
            <Label x={161} y={92 + i * 15} anchor="start" size={7} weight={i === 0 ? 700 : 500} color="#0f766e">
              {it}
            </Label>
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Automatik: Kalender + Ordner */
export function ArtAuto() {
  return (
    <Frame color="#f59e0b">
      <g transform="translate(26 26)">
        <rect width="56" height="56" rx="11" fill="#fff" filter="drop-shadow(0 2px 4px rgba(0,0,0,.15))" />
        <path d="M0 11a11 11 0 0 1 11-11h34a11 11 0 0 1 11 11v7H0z" fill="#f59e0b" />
        <Label x={28} y={13} color="#fff" size={8}>
          {isDe() ? 'JAN' : 'JAN'}
        </Label>
        <Label x={28} y={45} color="#0f172a" size={22} weight={800}>
          1
        </Label>
      </g>
      <Arrow x1={94} x2={116} y={54} />
      <Folder x={126} y={32} w={54} h={44} glow label="2026" />
    </Frame>
  );
}

/** Rückgängig: Datei mit Pfeil zurück */
export function ArtUndo() {
  return (
    <Frame color="#22c55e">
      <g transform="translate(40 26)">
        <rect width="52" height="64" rx="8" fill="#fff" filter="drop-shadow(0 2px 4px rgba(0,0,0,.15))" />
        <rect x="10" y="14" width="32" height="5" rx="2.5" fill="#cbd5e1" />
        <rect x="10" y="26" width="24" height="5" rx="2.5" fill="#e2e8f0" />
        <rect x="10" y="38" width="28" height="5" rx="2.5" fill="#e2e8f0" />
      </g>
      <g transform="translate(108 30)">
        <circle cx="28" cy="28" r="28" fill="#22c55e" />
        <path d="M18 24h18a9 9 0 0 1 0 18h-6" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M24 16l-8 8 8 8" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Frame>
  );
}

export const TASK_ART: Record<string, () => React.ReactElement> = {
  structure: ArtStructure,
  images: ArtImages,
  send: ArtSend,
  receive: ArtReceive,
  rename: ArtRename,
  sort: ArtSort,
  pdf: ArtPdf,
  dates: ArtDates,
};
