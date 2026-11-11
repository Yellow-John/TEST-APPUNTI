/** Logo dell'app (stesso disegno dell'icona): foglio di appunti con una riga scritta a mano e una scintilla (AI). */
export function AppLogo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-hidden>
      <defs><linearGradient id="app-logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4F46E5"/>
      <stop offset=".55" stopColor="#7C3AED"/>
      <stop offset="1" stopColor="#C026D3"/>
      </linearGradient><radialGradient id="app-logo-h" cx=".25" cy=".15" r=".8"><stop offset="0" stopColor="#fff" stopOpacity=".35"/>
      <stop offset="1" stopColor="#fff" stopOpacity="0"/>
      </radialGradient></defs>
      <rect width="512" height="512" rx="116" fill="url(#app-logo-g)"/>
      <rect width="512" height="512" rx="116" fill="url(#app-logo-h)"/>
      <g transform="rotate(-7 256 268)"><rect x="150" y="118" width="236" height="300" rx="40" fill="#1E1B4B" opacity=".28" transform="translate(10 18)"/>
      <rect x="150" y="118" width="236" height="300" rx="40" fill="#FFFFFF"/>
      <path d="M190 214c18-22 34-22 46 0s28 22 46 0 30-20 46-2" fill="none" stroke="#4F46E5" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M192 282h152" stroke="#C7D2FE" strokeWidth="18" strokeLinecap="round"/>
      <path d="M192 340h104" stroke="#C7D2FE" strokeWidth="18" strokeLinecap="round"/>
      </g><path d="M384 70c8 46 28 66 74 74-46 8-66 28-74 74-8-46-28-66-74-74 46-8 66-28 74-74z" fill="#FBBF24" stroke="#FFFFFF" strokeWidth="12" strokeLinejoin="round"/>
      <path d="M118 384c4 20 12 28 32 32-20 4-28 12-32 32-4-20-12-28-32-32 20-4 28-12 32-32z" fill="#FDE68A"/>
    </svg>
  );
}
