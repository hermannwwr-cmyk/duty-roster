// An infra engineer at work: an animated illustration for the top of the 2FA Login card.
// Plain SVG and CSS (see .engineer in styles.css); it holds still for people who turn off animations.
export const ENGINEER_SVG = `
<svg class="engineer" viewBox="0 0 360 172" role="img" aria-label="An infrastructure engineer typing at a desk next to a server rack">
  <defs>
    <clipPath id="eng-screen"><rect x="163" y="57" width="62" height="42" rx="2"/></clipPath>
  </defs>
  <line x1="12" y1="160" x2="348" y2="160" stroke="#26304d" stroke-width="2" stroke-linecap="round"/>

  <!-- Server rack with blinking lights -->
  <rect x="268" y="40" width="76" height="120" rx="6" fill="#141d36" stroke="#2a3560" stroke-width="2"/>
  ${[0, 1, 2, 3, 4].map(i => `
  <rect x="276" y="${50 + i * 21}" width="60" height="15" rx="3" fill="#1c2748"/>
  <circle class="led" style="animation-delay:${(i * 0.37) % 1.3}s" cx="284" cy="${57.5 + i * 21}" r="2.6" fill="${i % 2 ? '#8b9cff' : '#34d399'}"/>
  <circle class="led slow" style="animation-delay:${(i * 0.61) % 1.9}s" cx="292" cy="${57.5 + i * 21}" r="2.6" fill="#34d399"/>
  <path d="M302 ${54 + i * 21}h26M302 ${58 + i * 21}h26M302 ${62 + i * 21}h18" stroke="#2f3c6b" stroke-width="1.6" stroke-linecap="round"/>`).join('')}

  <!-- Padlock: the 2FA code -->
  <g class="lock">
    <circle cx="306" cy="20" r="13" fill="#4f46e5" opacity=".25" class="lock-pulse"/>
    <path d="M300 18v-4a6 6 0 0 1 12 0v4" fill="none" stroke="#c4b5fd" stroke-width="2.4"/>
    <rect x="297" y="17" width="18" height="13" rx="3" fill="#c4b5fd"/>
    <circle cx="306" cy="23" r="2" fill="#1e1b4b"/>
  </g>

  <!-- Desk -->
  <rect x="112" y="118" width="140" height="8" rx="3" fill="#2a3560"/>
  <rect x="120" y="126" width="6" height="34" rx="2" fill="#222c4d"/>
  <rect x="238" y="126" width="6" height="34" rx="2" fill="#222c4d"/>

  <!-- Monitor with scrolling code -->
  <rect x="158" y="52" width="72" height="52" rx="5" fill="#0b1020" stroke="#3b4a80" stroke-width="3"/>
  <g clip-path="url(#eng-screen)">
    <g class="code">
      ${[0, 1].map(k => [[34, '#8b9cff'], [22, '#34d399'], [44, '#c4b5fd'], [28, '#8b9cff'], [16, '#f9a8d4'], [38, '#34d399'], [26, '#c4b5fd']]
        .map(([w, c], j) => `<rect x="${j % 3 === 1 ? 172 : 165}" y="${60 + (k * 7 + j) * 7}" width="${w}" height="3" rx="1.5" fill="${c}" opacity=".85"/>`).join('')).join('')}
    </g>
  </g>
  <rect class="cursor" x="165" y="93" width="6" height="4" rx="1" fill="#e8ecf8"/>
  <rect x="190" y="104" width="8" height="12" fill="#2f3c6b"/>
  <rect x="180" y="115" width="28" height="3" rx="1.5" fill="#3b4a80"/>
  <rect x="146" y="114" width="30" height="4" rx="1.5" fill="#3b4a80"/>

  <!-- Coffee -->
  <rect x="236" y="104" width="11" height="14" rx="2.5" fill="#8b9cff"/>
  <path d="M247 107.5a3.5 3.5 0 0 1 0 7" fill="none" stroke="#8b9cff" stroke-width="2.2"/>
  <path class="steam" d="M239 100c-2-3 2-5 0-8" fill="none" stroke="#a3adca" stroke-width="1.6" stroke-linecap="round"/>
  <path class="steam late" d="M244 100c-2-3 2-5 0-8" fill="none" stroke="#a3adca" stroke-width="1.6" stroke-linecap="round"/>

  <!-- Chair -->
  <rect x="54" y="76" width="9" height="48" rx="4" fill="#26305a"/>
  <rect x="58" y="118" width="46" height="7" rx="3.5" fill="#26305a"/>
  <rect x="78" y="125" width="5" height="25" fill="#222c4d"/>
  <path d="M62 152h38" stroke="#222c4d" stroke-width="4" stroke-linecap="round"/>
  <circle cx="64" cy="156" r="3" fill="#2f3c6b"/><circle cx="98" cy="156" r="3" fill="#2f3c6b"/>

  <!-- Engineer -->
  <g class="breathe">
    <rect x="110" y="117" width="10" height="36" rx="5" fill="#1e293b"/>
    <rect x="108" y="150" width="22" height="7" rx="3.5" fill="#e8ecf8"/>
    <rect x="76" y="111" width="44" height="12" rx="6" fill="#1e293b"/>
    <rect x="66" y="80" width="32" height="42" rx="13" fill="#6d5df5"/>
    <path class="arm back" d="M92 90 L112 104 L146 110" fill="none" stroke="#5246d6" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="arm back" cx="148" cy="110" r="4.2" fill="#b97b55"/>
    <rect x="87" y="72" width="9" height="10" rx="3" fill="#c98b63"/>
    <circle cx="92" cy="62" r="14" fill="#c98b63"/>
    <path d="M78 63c-1-12 8-19 18-17 7 1 11 6 11 9-5-2-11-1-15 2-3 3-4 6-6 9-3 0-6-1-8-3z" fill="#1f1a2e"/>
    <circle class="blink" cx="100" cy="62" r="1.5" fill="#1f1a2e"/>
    <path d="M80 57a14 14 0 0 1 24-3" fill="none" stroke="#e8ecf8" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="77" y="58" width="7" height="10" rx="3" fill="#e8ecf8"/>
    <path d="M82 67c3 6 10 7 18 6" fill="none" stroke="#e8ecf8" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="101" cy="73" r="1.8" fill="#e8ecf8"/>
    <path class="arm front" d="M88 92 L108 106 L144 114" fill="none" stroke="#7c6ff7" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="arm front" cx="146" cy="114" r="4.4" fill="#c98b63"/>
  </g>
</svg>`;
