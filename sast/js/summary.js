// function updateSummary() {
//   const cards = [...document.querySelectorAll('[data-severity]')];
//   const counts = {
//     high: 0,
//     medium: 0,
//     low: 0,
//     safe: 0
//   };
//   for (const card of cards) {
//     const sev = (card.getAttribute('data-severity') || '').toLowerCase();
//     if (counts[sev] !== undefined) counts[sev]++;
//   }
//   const total = cards.length;
//   const set = (id, v) => {
//     const el = document.getElementById(id);
//     if (el) el.textContent = v;
//   };
//   set('count-high', counts.high);
//   set('count-medium', counts.medium);
//   set('count-low', counts.low);
//   set('count-safe', counts.safe);
//   set('count-total', total);
// }


function updateSummary() {
  const cards = Array.from(document.querySelectorAll('[data-severity]'));
  const counts = { high: 0, medium: 0, low: 0, safe: 0 };

  for (const card of cards) {
    const attr = (card.getAttribute('data-severity') || '').toLowerCase();
    const sevs = new Set(
      attr.split(',').map(s => s.trim()).filter(Boolean)
    );
    for (const s of sevs) {
      if (Object.prototype.hasOwnProperty.call(counts, s)) {
        counts[s]++;
      }
    }
  }

  
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  const total = counts.high + counts.medium + counts.low + counts.safe;

  set('count-high', counts.high);
  set('count-medium', counts.medium);
  set('count-low', counts.low);
  set('count-safe', counts.safe);
  set('count-total', total);
}