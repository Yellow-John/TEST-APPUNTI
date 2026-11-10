/** Logo dell'app (stesso disegno dell'icona): pagina con angolo piegato e scintilla. */
export function AppLogo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-hidden>
      <defs>
        <linearGradient id="app-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#app-logo-g)" />
      <path d="M168 112h128l88 88v180a24 24 0 0 1-24 24H168a24 24 0 0 1-24-24V136a24 24 0 0 1 24-24z" fill="#fff" />
      <path d="M296 112v64a24 24 0 0 0 24 24h64z" fill="#DDD6FE" />
      <path d="M264 236c5 38 22 55 60 60-38 5-55 22-60 60-5-38-22-55-60-60 38-5 55-22 60-60z" fill="#7C3AED" />
    </svg>
  );
}
