import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, Field, Select, Spinner } from '../ui';
import { useToast } from '../ui/toast';
import CatalogTable from './CatalogTable';

// Product catalog upload. A CSV, or an .xlsx workbook with sheet/column/price
// selection (Feature 1), becomes structured tenant-scoped rows plus a document
// the bots answer price/product questions from (apps/api/src/services/
// catalogIngest.js). Header validation and row parsing are server-side; this
// surfaces the result, and for .xlsx collects the sheet + column mapping first.
const REQUIRED_HEADERS = ['Product Name', 'SKU', 'Price', 'Description'];
const TEMPLATE_CSV = 'Product Name,SKU,Price,Description,Category,Image URL,Product URL\n'
  + 'Example Widget,WID-001,$19.99,A short description of the product,Widgets,https://example.com/widget.jpg,https://store.example.com/widget\n'
  + 'Example Gadget,GAD-002,$149.00,Another product description,Gadgets,,\n';

// The fields an .xlsx column can map to, with the keywords used to auto-guess a
// column from its header text. `name` is the only required one.
const XLSX_FIELDS = [
  { key: 'name', label: 'Product / item name', required: true, keywords: ['name', 'title', 'product', 'item', 'course'] },
  { key: 'price', label: 'Price', keywords: ['price', 'cost', 'amount', 'mrp', 'rate', 'fee'] },
  { key: 'description', label: 'Description / details', keywords: ['desc', 'detail', 'about', 'summary'] },
  { key: 'category', label: 'Category / type', keywords: ['category', 'type', 'group', 'collection'] },
  { key: 'sku', label: 'SKU / code', keywords: ['sku', 'code', 'id', 'ref'] },
  { key: 'imageUrl', label: 'Image URL', keywords: ['image', 'photo', 'img', 'picture'] },
  { key: 'productUrl', label: 'Product / buy URL', keywords: ['url', 'link', 'buy', 'product url'] }
];

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'product-catalog-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Best-effort column guess: the first header whose text contains a field keyword.
function guessMapping(headers) {
  const used = new Set();
  const mapping = {};
  for (const field of XLSX_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && field.keywords.some((kw) => String(h).toLowerCase().includes(kw)));
    if (idx >= 0) { mapping[field.key] = idx; used.add(idx); }
  }
  return mapping;
}

export default function CatalogPanel({ ws }) {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [sells, setSells] = useState(false);
  const csvInputRef = useRef(null);
  const xlsxInputRef = useRef(null);
  const [preview, setPreview] = useState(null); // { fileName, sheets } from the .xlsx preview
  const [pendingFile, setPendingFile] = useState(null); // the File awaiting import

  const load = () => ws.getCatalog().then((s) => { setSummary(s); if (s?.hasCatalog) setSells(true); }).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ws]);

  const onCsv = async (e) => {
    const file = e.target.files?.[0];
    if (csvInputRef.current) csvInputRef.current.value = '';
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { toast.error('Please choose a .csv file.'); return; }
    setUploading(true);
    try {
      const r = await ws.uploadCatalog(file);
      toast.success(`Imported ${r.productCount} product${r.productCount === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped)` : ''}.`);
      setSummary({ hasCatalog: r.productCount > 0, productCount: r.productCount });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const onXlsx = async (e) => {
    const file = e.target.files?.[0];
    if (xlsxInputRef.current) xlsxInputRef.current.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { toast.error('Choose an .xlsx workbook. Save an older .xls file as .xlsx first.'); return; }
    setUploading(true);
    try {
      const p = await ws.previewCatalogXlsx(file);
      if (!p.sheets?.length) { toast.error('No sheets were found in that workbook.'); return; }
      setPreview(p);
      setPendingFile(file);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const onImported = (r) => {
    toast.success(`Imported ${r.productCount} product${r.productCount === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped)` : ''}.`);
    setSummary({ hasCatalog: r.productCount > 0, productCount: r.productCount });
    setPreview(null);
    setPendingFile(null);
  };

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Product & course catalog"
        description="Give your bots exact product and course data so they can answer price, availability and spec questions accurately." />

      {/* Gating checkbox: businesses that sell products/courses opt in. */}
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <Checkbox checked={sells} onChange={(e) => setSells(e.target.checked)}>
          <span className="font-medium text-fg">Do you sell physical products, digital items, or courses?</span>
        </Checkbox>
      </div>

      {sells && (
        <>
          {/* Why-it-matters helper text, above the upload area. */}
          <div className="mt-4 rounded-xl border border-brand-400/25 bg-brand-400/[0.06] p-4 text-[13px] leading-relaxed text-fg-2">
            <p className="font-medium text-fg">What to upload</p>
            <p className="mt-1">A CSV or Excel (.xlsx) catalog or item/course list with your <span className="font-medium">product or course names, SKUs/codes, prices and descriptions</span> (pricing sheets and course outlines work too).</p>
            <p className="mt-2 font-medium text-fg">Why it matters</p>
            <p className="mt-1">Your bots answer buying questions straight from this data — exact prices, what&apos;s included, availability — which is what turns a browsing visitor into a conversion. Without it, the bot can only talk in generalities.</p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {loading ? (
              <span className="inline-flex items-center gap-2 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading…</span>
            ) : (
              <Badge tone={summary?.hasCatalog ? 'success' : 'neutral'} dot>
                {summary?.hasCatalog ? `${summary.productCount} active item${summary.productCount === 1 ? '' : 's'}` : 'No items yet'}
              </Badge>
            )}
          </div>

          {preview ? (
            <XlsxMapping preview={preview} file={pendingFile} ws={ws} busy={uploading} setBusy={setUploading}
              onImported={onImported} onCancel={() => { setPreview(null); setPendingFile(null); }} />
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-center">
              <p className="text-sm text-fg-2">Bulk upload a catalog (.csv or .xlsx)</p>
              <p className="mt-1 text-[12px] text-fg-3">CSV columns: {REQUIRED_HEADERS.join(', ')} (optional: Category, Image URL, Product URL). Excel (.xlsx): pick the sheet and map columns next.</p>
              <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={onCsv} className="hidden" id="catalog-file-csv" />
              <input ref={xlsxInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onXlsx} className="hidden" id="catalog-file-xlsx" />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <Button type="button" variant="primary" disabled={uploading} onClick={() => csvInputRef.current?.click()}>
                  {uploading ? 'Working…' : (summary?.hasCatalog ? 'Replace via CSV' : 'Upload CSV')}
                </Button>
                <Button type="button" variant="secondary" disabled={uploading} onClick={() => xlsxInputRef.current?.click()}>
                  {summary?.hasCatalog ? 'Replace via Excel (.xlsx)' : 'Upload Excel (.xlsx)'}
                </Button>
                <Button type="button" variant="ghost" onClick={downloadTemplate}>Download CSV template</Button>
              </div>
              <p className="mt-3 text-[11.5px] text-fg-3">A bulk upload replaces the current catalog. Rows missing a name are skipped.</p>
            </div>
          )}

          {/* Fully visible, editable catalog. */}
          <div className="mt-6">
            <CatalogTable ws={ws} onChange={load} />
          </div>
        </>
      )}
    </Card>
  );
}

// ── .xlsx sheet + column/price mapping, shown after a workbook is previewed.
function XlsxMapping({ preview, file, ws, busy, setBusy, onImported, onCancel }) {
  const toast = useToast();
  const [sheetIdx, setSheetIdx] = useState(preview.sheets[0]?.index ?? 0);
  const sheet = useMemo(() => preview.sheets.find((s) => s.index === sheetIdx) || preview.sheets[0], [preview, sheetIdx]);
  const headers = sheet?.headers || [];
  const [mapping, setMapping] = useState(() => guessMapping(preview.sheets[0]?.headers || []));

  // Re-guess the mapping when the chosen sheet changes.
  const onSheet = (idx) => {
    setSheetIdx(idx);
    const next = preview.sheets.find((s) => s.index === idx);
    setMapping(guessMapping(next?.headers || []));
  };

  const setField = (key, value) => setMapping((m) => {
    const next = { ...m };
    if (value === '') delete next[key];
    else next[key] = Number(value);
    return next;
  });

  const run = async () => {
    if (mapping.name === undefined) { toast.error('Map a column to the product/item name.'); return; }
    setBusy(true);
    try {
      const r = await ws.importCatalogXlsx(file, { sheets: [{ index: sheetIdx, headerRow: 0, mapping }] });
      onImported(r);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-white/12 bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">Map “{preview.fileName}”</p>
          <p className="mt-0.5 text-[12px] text-fg-3">Choose the sheet, then tell us which column holds each field. The first row is treated as headers.</p>
        </div>
        <Field label="Sheet" className="w-56">
          <Select value={sheetIdx} onChange={(e) => onSheet(Number(e.target.value))} aria-label="Sheet to import">
            {preview.sheets.map((s) => <option key={s.index} value={s.index}>{s.name} ({Math.max(0, s.rowCount - 1)} rows)</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {XLSX_FIELDS.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
            <Select value={mapping[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} aria-label={f.label}>
              <option value="">{f.required ? '— choose a column —' : '— none —'}</option>
              {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
            </Select>
          </Field>
        ))}
      </div>

      {sheet?.sampleRows?.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-fg-3">
                {headers.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {sheet.sampleRows.slice(0, 5).map((row, ri) => (
                <tr key={ri} className="border-b border-white/[0.03] text-fg-2">
                  {headers.map((_, ci) => <td key={ci} className="max-w-[220px] truncate px-3 py-1.5">{row[ci] ?? ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" loading={busy} onClick={run}>Import catalog</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <span className="text-[11.5px] text-fg-3">This replaces the current catalog with the mapped rows.</span>
      </div>
    </div>
  );
}
