// Rio, the Payday capybara courier. Original inline SVG mascot, no external assets.
// Generated artwork: every pose shares the same body, satchel, head and cap.

export type RioPose = 'wave' | 'paid' | 'thinking' | 'idle';

export function Rio({
  pose = 'wave',
  size = 120,
  className,
  title,
}: {
  pose?: RioPose;
  size?: number;
  className?: string;
  title?: string;
}) {
  const label = title ?? 'Rio the capybara courier';
  // An empty title marks Rio as decoration (next to text that already says the same thing).
  const decorative = title === '';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      {!decorative && <title>{label}</title>}
      {/* feet, body, satchel with envelope */}
      <ellipse cx="100" cy="190" rx="54" ry="6" fill="#0B2A33" opacity="0.12"/>
      <ellipse cx="80" cy="185" rx="16" ry="8" fill="#8A5A3C"/>
      <ellipse cx="120" cy="185" rx="16" ry="8" fill="#8A5A3C"/>
      <ellipse cx="100" cy="148" rx="46" ry="40" fill="#A9744F"/>
      <ellipse cx="100" cy="156" rx="27" ry="26" fill="#C9966B"/>
      <path d="M136 112 L62 160" stroke="#0F766E" strokeWidth="7" strokeLinecap="round"/>
      <path d="M136 112 L62 160" stroke="#0B5750" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 6" opacity="0.7"/>
      <g transform="rotate(-12 62 150)">
      <rect x="49" y="137" width="27" height="20" rx="2" fill="#FFFDF8" stroke="#0B2A33" strokeWidth="1.6"/>
      <path d="M49.5 138 L62.5 148 L75.5 138" fill="none" stroke="#0B2A33" strokeWidth="1.6" strokeLinejoin="round"/>
      </g>
      <rect x="40" y="150" width="42" height="31" rx="7" fill="#0F766E"/>
      <path d="M40 157 a7 7 0 0 1 7 -7 h28 a7 7 0 0 1 7 7 v7 q-21 10 -42 0 z" fill="#0B5750"/>
      <circle cx="61" cy="168" r="3.2" fill="#F59E0B"/>
      {/* head, ears, courier cap with coin badge */}
      <circle cx="59" cy="51" r="10" fill="#8A5A3C"/>
      <circle cx="141" cy="51" r="10" fill="#8A5A3C"/>
      <circle cx="59" cy="52" r="5" fill="#C9966B"/>
      <circle cx="141" cy="52" r="5" fill="#C9966B"/>
      <rect x="54" y="38" width="92" height="80" rx="36" fill="#A9744F"/>
      <rect x="67" y="77" width="66" height="40" rx="20" fill="#C9966B"/>
      <rect x="83" y="80" width="34" height="15" rx="7.5" fill="#8A5A3C"/>
      <ellipse cx="92" cy="88" rx="3.2" ry="2.4" fill="#0B2A33"/>
      <ellipse cx="108" cy="88" rx="3.2" ry="2.4" fill="#0B2A33"/>
      <circle cx="69" cy="93" r="5.5" fill="#E8875B" opacity="0.45"/>
      <circle cx="131" cy="93" r="5.5" fill="#E8875B" opacity="0.45"/>
      <path d="M64 47 Q64 15 100 15 Q136 15 136 47 Z" fill="#0F766E"/>
      <path d="M66 40 Q100 31 134 40 L135 47 L65 47 Z" fill="#0B5750"/>
      <path d="M57 48 Q100 37 143 48 Q100 60 57 48 Z" fill="#0B2A33"/>
      <circle cx="100" cy="29" r="8.5" fill="#F59E0B" stroke="#B45309" strokeWidth="1.5"/>
      <circle cx="100" cy="29" r="4.6" fill="none" stroke="#FDE68A" strokeWidth="1.6"/>
      {pose === 'wave' && (
        <>
          <circle cx="76" cy="70" r="4.8" fill="#0B2A33"/>
          <circle cx="124" cy="70" r="4.8" fill="#0B2A33"/>
          <circle cx="77.6" cy="68.4" r="1.6" fill="#FFFFFF"/>
          <circle cx="125.6" cy="68.4" r="1.6" fill="#FFFFFF"/>
          <path d="M100 95 V101 M100 101 Q94 107 88 103 M100 101 Q106 107 112 103" fill="none" stroke="#0B2A33" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M60 130 Q49 143 55 157" fill="none" stroke="#8A5A3C" strokeWidth="14" strokeLinecap="round"/>
          <path d="M140 131 Q160 124 165 98" fill="none" stroke="#8A5A3C" strokeWidth="14" strokeLinecap="round"/>
          <path d="M177 84 q6 7 4 16 M184 76 q10 11 6 27" fill="none" stroke="#0F766E" strokeWidth="2.6" strokeLinecap="round"/>
        </>
      )}
      {pose === 'paid' && (
        <>
          <path d="M70 72 Q76 64 82 72 M118 72 Q124 64 130 72" fill="none" stroke="#0B2A33" strokeWidth="2.8" strokeLinecap="round"/>
          <path d="M100 95 V99" fill="none" stroke="#0B2A33" strokeWidth="2.2" strokeLinecap="round"/>
          <path d="M89 100 Q100 104 111 100 Q109 112 100 112 Q91 112 89 100 Z" fill="#0B2A33"/>
          <path d="M95 109 Q100 105.5 105 109 Q100 113 95 109 Z" fill="#E8875B"/>
          <path d="M60 130 Q49 143 55 157" fill="none" stroke="#8A5A3C" strokeWidth="14" strokeLinecap="round"/>
          <circle cx="166" cy="80" r="15" fill="#F59E0B" stroke="#B45309" strokeWidth="2"/>
          <circle cx="166" cy="80" r="9.5" fill="none" stroke="#FDE68A" strokeWidth="2"/>
          <path d="M166 75 V85" stroke="#B45309" strokeWidth="2.4" strokeLinecap="round"/>
          <path d="M140 131 Q160 124 164 102" fill="none" stroke="#8A5A3C" strokeWidth="14" strokeLinecap="round"/>
          <path d="M187 49 Q187 56 194 56 Q187 56 187 63 Q187 56 180 56 Q187 56 187 49 Z" fill="#F59E0B"/>
          <path d="M143 52 Q143 57 148 57 Q143 57 143 62 Q143 57 138 57 Q143 57 143 52 Z" fill="#F59E0B"/>
          <path d="M188 101 Q188 106 193 106 Q188 106 188 111 Q188 106 183 106 Q188 106 188 101 Z" fill="#F59E0B"/>
        </>
      )}
      {pose === 'thinking' && (
        <>
          <circle cx="73.5" cy="70" r="4.8" fill="#0B2A33"/>
          <circle cx="121.5" cy="70" r="4.8" fill="#0B2A33"/>
          <circle cx="75.1" cy="68.4" r="1.6" fill="#FFFFFF"/>
          <circle cx="123.1" cy="68.4" r="1.6" fill="#FFFFFF"/>
          <path d="M117 60 Q124 54 131 58" fill="none" stroke="#8A5A3C" strokeWidth="2.6" strokeLinecap="round"/>
          <path d="M100 95 V100 M93 103 Q100 106 107 103" fill="none" stroke="#0B2A33" strokeWidth="2.2" strokeLinecap="round"/>
          <path d="M33 96 L38 110" stroke="#0B2A33" strokeWidth="5.5" strokeLinecap="round"/>
          <circle cx="28" cy="82" r="14" fill="#DDF3EF" stroke="#0B2A33" strokeWidth="4"/>
          <path d="M20 79 Q23 72 30 72" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round"/>
          <path d="M60 132 Q44 130 39 112" fill="none" stroke="#8A5A3C" strokeWidth="14" strokeLinecap="round"/>
          <path d="M143 138 Q164 121 121 109" fill="none" stroke="#8A5A3C" strokeWidth="14" strokeLinecap="round"/>
        </>
      )}
      {pose === 'idle' && (
        <>
          <circle cx="76" cy="70" r="4.8" fill="#0B2A33"/>
          <circle cx="124" cy="70" r="4.8" fill="#0B2A33"/>
          <circle cx="77.6" cy="68.4" r="1.6" fill="#FFFFFF"/>
          <circle cx="125.6" cy="68.4" r="1.6" fill="#FFFFFF"/>
          <path d="M100 95 V101 M100 101 Q94 107 88 103 M100 101 Q106 107 112 103" fill="none" stroke="#0B2A33" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M60 130 Q49 143 55 157" fill="none" stroke="#8A5A3C" strokeWidth="14" strokeLinecap="round"/>
          <path d="M140 130 Q152 144 147 160" fill="none" stroke="#8A5A3C" strokeWidth="14" strokeLinecap="round"/>
        </>
      )}
    </svg>
  );
}

export default Rio;
