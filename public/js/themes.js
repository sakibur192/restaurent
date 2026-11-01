// Guest menu themes — shared by the online menu and the owner's theme editor
const MENU_PRESETS = {
  classic: { name: 'Classic', name_bn: 'ক্লাসিক', layout: 'list', primary: '#0f766e', accent: '#f59e0b', bg: '#f4f6f8', card: '#ffffff', text: '#0f172a', header: '#0b2545', font: 'sans', radius: 14 },
  midnight: { name: 'Midnight', name_bn: 'মিডনাইট ডার্ক', layout: 'grid', primary: '#f59e0b', accent: '#22d3ee', bg: '#0b1020', card: '#161d31', text: '#e8ecf4', header: '#0b1020', font: 'sans', radius: 16 },
  fresh: { name: 'Fresh green', name_bn: 'ফ্রেশ গ্রিন', layout: 'grid', primary: '#16a34a', accent: '#f97316', bg: '#eff8f1', card: '#ffffff', text: '#14361f', header: '#15803d', font: 'rounded', radius: 20 },
  bistro: { name: 'Warm bistro', name_bn: 'ওয়ার্ম বিস্ট্রো', layout: 'magazine', primary: '#9a3412', accent: '#b45309', bg: '#f6efe4', card: '#fffaf2', text: '#3b2416', header: '#3b2416', font: 'serif', radius: 6 },
  minimal: { name: 'Minimal', name_bn: 'মিনিমাল', layout: 'compact', primary: '#111111', accent: '#e11d48', bg: '#ffffff', card: '#ffffff', text: '#111111', header: '#ffffff', font: 'sans', radius: 0 },
  street: { name: 'Street food', name_bn: 'স্ট্রিট ফুড', layout: 'grid', primary: '#dc2626', accent: '#facc15', bg: '#fff8dc', card: '#ffffff', text: '#1c1917', header: '#dc2626', font: 'rounded', radius: 18 },
  royal: { name: 'Royal gold', name_bn: 'রয়্যাল গোল্ড', layout: 'magazine', primary: '#d4a24c', accent: '#e9c46a', bg: '#17120d', card: '#231b13', text: '#f5ead8', header: '#17120d', font: 'serif', radius: 10 },
  pastel: { name: 'Café pastel', name_bn: 'ক্যাফে প্যাস্টেল', layout: 'grid', primary: '#db2777', accent: '#7c3aed', bg: '#fdf2f6', card: '#ffffff', text: '#3f2a34', header: '#fbcfe8', font: 'rounded', radius: 22 }
};
const MENU_LAYOUTS = { list: 'List — photo on the left', grid: 'Grid — photo cards', compact: 'Compact — text menu, no photos', magazine: 'Magazine — big photos' };
const MENU_FONTS = { sans: 'Modern', serif: 'Elegant (serif)', rounded: 'Friendly (rounded)' };

function themeHex(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); return m ? [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16)) : [0, 0, 0]; }
function themeLum(h) { const [r, g, b] = themeHex(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; }
function themeMix(a, b, t) { const x = themeHex(a), y = themeHex(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function themeOn(bg) { return themeLum(bg) > .45 ? '#111827' : '#ffffff'; }
// full theme = preset values + owner overrides
function resolveTheme(t) {
  t = t || {}; const p = MENU_PRESETS[t.preset] || MENU_PRESETS.classic; const o = Object.assign({}, p, { preset: MENU_PRESETS[t.preset] ? t.preset : 'classic' });
  ['layout', 'primary', 'accent', 'bg', 'card', 'text', 'header', 'font'].forEach(k => { if (t[k]) o[k] = t[k]; });
  if (t.radius !== undefined && t.radius !== null && t.radius !== '') o.radius = Number(t.radius);
  o.show_images = t.show_images !== false; o.show_desc = t.show_desc !== false; o.cover_id = t.cover_id || null;
  if (!o.show_images && o.layout !== 'compact') o.layout = o.layout === 'grid' || o.layout === 'magazine' ? 'list' : o.layout;
  return o;
}
function applyTheme(t, root) {
  root = root || document.documentElement; const st = root.style;
  const dark = themeLum(t.bg) < .2;
  const vars = {
    '--brand': t.primary, '--brand-l': themeMix(t.card, t.primary, dark ? .25 : .12), '--m-primary': t.primary, '--m-on-primary': themeOn(t.primary), '--m-accent': t.accent,
    '--m-bg': t.bg, '--m-card': t.card, '--m-text': t.text, '--m-muted': themeMix(t.text, t.card, .42), '--m-line': themeMix(t.card, t.text, dark ? .16 : .1),
    '--m-header': t.header, '--m-on-header': themeOn(t.header), '--m-r': t.radius + 'px', '--m-r-sm': Math.max(0, Math.round(t.radius * .7)) + 'px',
    '--m-font': t.font === 'serif' ? "'Playfair Display',Georgia,'Hind Siliguri',serif" : t.font === 'rounded' ? "'Nunito','Trebuchet MS','Hind Siliguri',system-ui,sans-serif" : "Inter,'Hind Siliguri',system-ui,sans-serif",
    // dark themes: make the shared UI (modals, inputs) readable too
    '--card': t.card, '--bg': t.bg, '--text': t.text, '--muted': themeMix(t.text, t.card, .42), '--line': themeMix(t.card, t.text, dark ? .16 : .1), '--soft': themeMix(t.card, t.text, .05), '--navy': dark ? t.text : themeMix(t.text, '#0b2545', .3)
  };
  Object.entries(vars).forEach(([k, v]) => st.setProperty(k, v));
  const b = document.body; if (b) { b.classList.remove('l-list', 'l-grid', 'l-compact', 'l-magazine', 'dark-theme', 'noimg', 'nodesc'); b.classList.add('l-' + t.layout); if (dark) b.classList.add('dark-theme'); if (!t.show_images) b.classList.add('noimg'); if (!t.show_desc) b.classList.add('nodesc'); }
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = t.header;
}
