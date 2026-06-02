const fs = require('fs');
const p = "c:\\Users\\jasmi\\Desktop\\important stuff\\Fair play\\ Fair play wb\\fair-play-football\\components\\games\\GameDetails.tsx";
let s = fs.readFileSync(p,'utf8');

s = s.replace("const [statusMessage, setStatusMessage] = useState<string | null>(null);", `const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
  }, [statusMessage]);`);

s = s.replace(/<div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500\\/20 bg-emerald-500\\/10 px-4 py-2 text-sm text-emerald-200 shadow-sm transition-opacity duration-300">[\s\S]*?<\\/div>/, `<div className={\`mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 shadow-sm transition-opacity duration-300 \${showStatusBadge ? "opacity-100" : "opacity-0"}\`}>\n                <span className="text-emerald-200">?</span>\n                <span>{statusMessage.includes("Profile") ? statusMessage : "Profile verified"}</span>\n              </div>`);

fs.writeFileSync(p,s,'utf8');
console.log('patched');
