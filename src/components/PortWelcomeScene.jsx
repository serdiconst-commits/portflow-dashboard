import './PortWelcomeScene.css';

export default function PortWelcomeScene({ compact = false }) {
  return (
    <section className={`port-welcome${compact ? ' port-welcome--compact' : ''}`} aria-label="PortFlow animated container port">
      <div className="port-welcome-copy">
        <span className="port-welcome-eyebrow">PORTFLOW / ALWAYS MOVING</span>
        <h2>{compact ? 'Your next move starts here.' : 'Keep your world moving.'}</h2>
        {!compact && <p>From the port to the open road. One connected journey.</p>}
      </div>
      <svg className="port-welcome-art" viewBox="0 0 800 430" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={compact ? 'port-sky-small' : 'port-sky'} x2="0" y2="1">
            <stop stopColor="#102c53"/><stop offset="1" stopColor="#215a7c"/>
          </linearGradient>
          <pattern id={compact ? 'port-ribs-small' : 'port-ribs'} width="15" height="20" patternUnits="userSpaceOnUse">
            <path d="M3 0v20" stroke="#fff" strokeOpacity=".16" strokeWidth="2"/>
          </pattern>
        </defs>
        <rect width="800" height="430" fill={`url(#${compact ? 'port-sky-small' : 'port-sky'})`}/>
        <circle cx="645" cy="105" r="53" fill="#8edfdc" opacity=".16"/>
        <circle cx="645" cy="105" r="30" fill="#c2f3e6"/>
        <g fill="#102e4a" opacity=".7">
          <path d="M0 241h45v-40h40v40h36v-68h44v68h30v-37h45v37h38v-55h40v55h482v100H0z"/>
        </g>
        <g fill="none" stroke="#70a4b9" strokeWidth="7" strokeLinejoin="round">
          <path d="M100 290V95h195M100 95l90-51 105 51M190 44v246M100 148h90M100 205h90M460 290V79h218M460 79l103-44 115 44M563 35v255M460 140h103M460 205h103"/>
          <path d="M278 96v87m-14 0h28M658 80v90m-14 0h28" strokeWidth="3"/>
        </g>
        <g className="port-welcome-cargo">
          <rect x="238" y="185" width="95" height="43" rx="3" fill="#47bfc3"/>
          <rect x="238" y="185" width="95" height="43" fill={`url(#${compact ? 'port-ribs-small' : 'port-ribs'})`}/>
          <path d="M258 185l20-18 27 18" fill="none" stroke="#c4e9ef" strokeWidth="2"/>
        </g>
        <path d="M0 303h800v65H0z" fill="#163e58"/>
        <g stroke="#4e9caa" strokeWidth="2" opacity=".35"><path d="M30 324h155m40 20h210m70-19h180"/></g>
        <g>
          <rect x="25" y="260" width="180" height="52" rx="3" fill="#296c85"/>
          <rect x="211" y="260" width="150" height="52" rx="3" fill="#d68d56"/>
          <rect x="63" y="205" width="142" height="51" rx="3" fill="#388f9d"/>
          <path d="M25 260h336v52H25zM63 205h142v51H63z" fill={`url(#${compact ? 'port-ribs-small' : 'port-ribs'})`}/>
        </g>
        <path d="M0 358h800v72H0z" fill="#0b1a30"/>
        <path className="port-welcome-road" d="M0 403h800" stroke="#7591a9" strokeWidth="3" strokeDasharray="34 28"/>
        <g className="port-welcome-truck">
          <ellipse cx="424" cy="383" rx="172" ry="9" fill="#040d1b" opacity=".5"/>
          <rect x="263" y="283" width="230" height="78" rx="4" fill="#35b6bd"/>
          <rect x="263" y="283" width="230" height="78" fill={`url(#${compact ? 'port-ribs-small' : 'port-ribs'})`}/>
          <text x="288" y="328" fill="#e4ffff" fontSize="22" fontWeight="800" letterSpacing="3">PORTFLOW</text>
          <path d="M497 307h45l34 34v29h-79z" fill="#edf5fa"/>
          <path d="M509 316h28l23 24h-51z" fill="#133653"/>
          <path d="M263 362h318v9H263z" fill="#70879c"/>
          <path d="M568 347h10v8h-10z" fill="#ffdf9b"/>
          <path d="M510 350h13" stroke="#92a8b8" strokeWidth="3"/>
          {[291, 320, 475, 548].map((x) => <g key={x}><circle cx={x} cy="372" r="14" fill="#07101f"/><circle cx={x} cy="372" r="6" fill="#a6bdce"/></g>)}
        </g>
      </svg>
      <div className="port-welcome-caption"><span className="port-welcome-dot"/> Ports. People. Possibilities.</div>
    </section>
  );
}
