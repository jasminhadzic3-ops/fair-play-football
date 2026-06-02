const fs = require('fs');
const p = 'components/games/GameDetails.tsx';
let s = fs.readFileSync(p,'utf8');

const needle = "const [statusMessage, setStatusMessage] = useState<string | null>(null);";
if (s.indexOf(needle) === -1) {
  console.error('needle not found');
  process.exit(1);
}
const insert = `const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showStatusBadge, setShowStatusBadge] = useState(true);

  useEffect(() => {
    let t;
    if (statusMessage) {
      setShowStatusBadge(true);
      t = setTimeout(() => setShowStatusBadge(false), 2500);
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [statusMessage]);`;

s = s.replace(needle, insert);

// Replace the badge div block using a simple marker-based replace
const oldBadge = `<div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 shadow-sm transition-opacity duration-300">
                <span className="text-emerald-200">?</span>
                <span>{statusMessage.includes("Profile") ? statusMessage : "Profile verified"}</span>
              </div>`;
const newBadge = `<div className={\`mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 shadow-sm transition-opacity duration-300 \${showStatusBadge ? "opacity-100" : "opacity-0"}\`}>
                <span className="text-emerald-200">?</span>
                <span>{statusMessage.includes("Profile") ? statusMessage : "Profile verified"}</span>
              </div>`;
if (s.indexOf(oldBadge) === -1) {
  console.error('old badge not found');
  process.exit(1);
}

s = s.replace(oldBadge, newBadge);
fs.writeFileSync(p, s, 'utf8');
console.log('patched');
