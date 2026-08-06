const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ADVOCATE_INPUT = 'k chandrasekaran';
const BASE = 'https://mhc.tn.gov.in/judis/clists/clists-madras';
const DAYS_AHEAD = 1; // fetch tomorrow's list; no fallback — empty list means empty PDF

function normalizeAdvocate(name) {
  const parts = name.trim().toUpperCase().split(/\s+/);
  if (parts.length <= 1) return parts.join('');
  return parts[0] + '.' + parts.slice(1).join(' ');
}
// Current date/time in IST (UTC+5:30, no DST), independent of the system
// timezone. The returned Date must be read with getUTC*/setUTC* methods.
function nowIST() {
  return new Date(Date.now() + 330 * 60000);
}
function fileFor(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return { file: `cause_${dd}${mm}${yyyy}.xml`, cdate: `${yyyy}-${mm}-${dd}` };
}

// Robust fetch: buffers the body, decompresses gzip/deflate, follows redirects.
// The MHC server sends an incomplete certificate chain, so Node's bundled CAs
// can't verify it. On that specific error, retry once without verification.
let warnedInsecure = false;
function fetchText(url, redirects = 0, insecure = false) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Encoding': 'gzip, deflate',
      },
      rejectUnauthorized: !insecure,
    }, res => {
      // follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(fetchText(next, redirects + 1, insecure));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      const chunks = [];
      stream.on('data', c => chunks.push(c));           // collect as Buffers
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    req.on('error', err => {
      if (!insecure && err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        if (!warnedInsecure) {
          warnedInsecure = true;
          console.log('\n(Certificate chain incomplete on server; retrying without TLS verification.)');
        }
        return resolve(fetchText(url, redirects, true));
      }
      reject(err);
    });
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
  });
}

const flat = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? '' : x).join(' ') : (v || '');
function advocateBlob(c) {
  const parts = [flat(c.mpadv), flat(c.mradv)];
  const ex = c.extra;
  if (Array.isArray(ex)) {
    for (const e of ex) if (e && typeof e === 'object') parts.push(flat(e.expadv), flat(e.exradv));
  } else if (ex && typeof ex === 'object') {
    parts.push(flat(ex.expadv), flat(ex.exradv));
  }
  return parts.join(' | ').toUpperCase();
}

(async () => {
  const advocate = normalizeAdvocate(ADVOCATE_INPUT);
  console.log(`Advocate: "${ADVOCATE_INPUT}" -> "${advocate}"`);

  const d = nowIST();
  d.setUTCDate(d.getUTCDate() + DAYS_AHEAD);
  const { file, cdate } = fileFor(d);
  process.stdout.write(`Fetching ${cdate} (${file}) ... `);
  let data = [];
  try {
    const day = JSON.parse(await fetchText(`${BASE}/api/result.php?file=${file}`));
    if (Array.isArray(day)) data = day;
    console.log(`${data.length} records`);
  } catch (e) {
    console.log(`no list available (${e.message})`);
  }

  const clean = s => s.replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim();

  // Pull out just the portion of an advocate field that mentions our advocate:
  // the matching comma-segment plus the "FOR Rx / FOR PETITIONER" designation
  // that follows it, instead of the whole (often huge) field.
  function appearanceSnippet(field) {
    const segs = field.split(',');
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      if (clean(segs[i]).toUpperCase().includes(advocate)) {
        let snip = clean(segs[i]);
        if (segs[i + 1] && /^\s*FOR\b/i.test(segs[i + 1])) snip += ', ' + clean(segs[i + 1]);
        out.push(snip);
      }
    }
    return out.join('; ');
  }

  // Find every place the advocate appears in a record: main case petitioner or
  // respondent side, or inside a connected (extra) case.
  function findAppearances(c) {
    const hits = [];
    const check = (val, side, conn) => {
      const s = flat(val);
      if (s.toUpperCase().includes(advocate)) hits.push({ side, conn, text: appearanceSnippet(s) });
    };
    check(c.mpadv, 'Petitioner side', null);
    check(c.mradv, 'Respondent side', null);
    const extras = Array.isArray(c.extra) ? c.extra : (c.extra && typeof c.extra === 'object' ? [c.extra] : []);
    for (const e of extras) {
      if (!e || typeof e !== 'object') continue;
      const conn = clean(`${flat(e.excasetype)} ${flat(e.excaseno)}/${flat(e.excaseyr)}`);
      check(e.expadv, 'Petitioner side', conn);
      check(e.exradv, 'Respondent side', conn);
    }
    return hits;
  }

  const cases = [];
  for (const c of data) {
    const hits = findAppearances(c);
    if (!hits.length) continue;
    const caseNo = `${flat(c.mcasetype)} ${flat(c.mcaseno)}/${flat(c.mcaseyr)}`.trim();
    const party  = clean(`${flat(c.pname)} VS ${flat(c.rname)}`);
    const court  = clean(flat(c.courtno));
    const judges = clean([flat(c.judge1), flat(c.judge2)].filter(Boolean).join(' & '))
      .replace(/The Honourable\s*/gi, '').replace(/Mr\.?\s*Justice\s*/gi, 'Justice ');
    const appearance = hits.map(h =>
      `${h.text} — ${h.side}${h.conn ? ` (in connected ${h.conn})` : ''}`
    ).filter((v, i, a) => a.indexOf(v) === i).join('\n');
    cases.push({ caseNo, party, court, judges, appearance });
  }

  console.log(`\nList date used: ${cdate}`);
  console.log(`Found ${cases.length} case(s) for "${advocate}"`);
  cases.forEach((c, i) => {
    console.log(` ${i + 1}. ${c.caseNo}  |  ${c.party}`);
    console.log(`     Court: ${c.court || '-'}${c.judges ? ' — ' + c.judges : ''}`);
    console.log(`     Appearance: ${c.appearance.replace(/\n/g, ' | ')}`);
  });

  const outDir = path.join(__dirname, 'pdfs');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `MHC_cases_${cdate}.pdf`);
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(outFile));
  doc.fontSize(16).text('High Court of Madras — Daily Cause List', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).text(`List date: ${cdate}`, { align: 'center' });
  doc.text(`Advocate: ${advocate}`, { align: 'center' });
  doc.moveDown(1);
  if (cases.length === 0) {
    doc.fontSize(12).text('No matching cases found (or no list published for this date).');
  } else {
    // Table layout
    const cols = [
      { key: 'sno',        label: '#',            width: 24 },
      { key: 'caseNo',     label: 'Case No',      width: 78 },
      { key: 'party',      label: 'Parties',      width: 150 },
      { key: 'courtCell',  label: 'Court / Judge', width: 110 },
      { key: 'appearance', label: 'Appearance',   width: 150 },
    ];
    const tableX = doc.page.margins.left;
    const pad = 4, fontSize = 9;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    const rows = cases.map((c, i) => ({
      sno: String(i + 1),
      caseNo: c.caseNo,
      party: c.party,
      courtCell: `${c.court}${c.judges ? '\n' + c.judges : ''}`,
      appearance: c.appearance,
    }));

    function rowHeight(row, font) {
      doc.font(font).fontSize(fontSize);
      let h = 0;
      for (const col of cols) {
        h = Math.max(h, doc.heightOfString(row[col.key] || '', { width: col.width - pad * 2 }));
      }
      return h + pad * 2;
    }
    function drawRow(row, font) {
      const h = rowHeight(row, font);
      if (doc.y + h > bottom()) { doc.addPage(); }
      const y = doc.y;
      let x = tableX;
      doc.font(font).fontSize(fontSize);
      for (const col of cols) {
        doc.rect(x, y, col.width, h).stroke();
        doc.text(row[col.key] || '', x + pad, y + pad, { width: col.width - pad * 2 });
        x += col.width;
      }
      doc.x = tableX;
      doc.y = y + h;
    }

    drawRow({ sno: '#', caseNo: 'Case No', party: 'Parties', courtCell: 'Court / Judge', appearance: 'Appearance' }, 'Helvetica-Bold');
    for (const row of rows) drawRow(row, 'Helvetica');
  }
  doc.end();
  console.log(`\nPDF written to ${outFile}`);
})();
