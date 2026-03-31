import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { MerchantNetworkSelector } from '@/components/orders/import/MerchantNetworkSelector';
import { ImportPreviewTable } from '@/components/orders/import/ImportPreviewTable';
import { ImportSourceTabs } from '@/components/orders/import/ImportSourceTabs';
import type { LedgerNetworkMerchant, LedgerParseRow, LedgerSourceType } from '@/types/ledgerImport';
import { parseLedgerText } from '@/services/ledgerImport/parser';
import { readTextFile, validateTextFile } from '@/services/ledgerImport/fileReaders/textFileReader';
import { readSpreadsheet, validateSpreadsheetFile } from '@/services/ledgerImport/fileReaders/spreadsheetReader';
import { assessOcrTextQuality, extractTextFromImage, type OcrExtractionResult, validateImageFile } from '@/services/ledgerImport/fileReaders/imageReader';
import { buildNetworkMerchants } from '@/services/ledgerImport/network';
import { canSaveImportedRows } from '@/services/ledgerImport/guards';

export default function OrdersImportLedgerPage() {
  const navigate = useNavigate();
  const { userId, merchantProfile } = useAuth();

  const [sourceType, setSourceType] = useState<LedgerSourceType>('pasted_text');
  const [rawText, setRawText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');
  const [ocrStatus, setOcrStatus] = useState('Idle');
  const [ocrWarning, setOcrWarning] = useState<string | null>(null);
  const [ocrMetadata, setOcrMetadata] = useState<Record<string, unknown> | null>(null);
  const [extractedImageText, setExtractedImageText] = useState('');
  const [merchants, setMerchants] = useState<LedgerNetworkMerchant[]>([]);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState('');
  const [rows, setRows] = useState<LedgerParseRow[]>([]);
  const [batchId, setBatchId] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const selectedMerchant = merchants.find((m) => m.relationshipId === selectedRelationshipId) || null;

  useEffect(() => {
    const loadNetworkMerchants = async () => {
      if (!merchantProfile?.merchant_id) return;
      const myMerchantId = merchantProfile.merchant_id;

      const [relRes, profileRes] = await Promise.all([
        supabase
          .from('merchant_relationships')
          .select('id, merchant_a_id, merchant_b_id')
          .eq('status', 'active')
          .or(`merchant_a_id.eq.${myMerchantId},merchant_b_id.eq.${myMerchantId}`),
        supabase.from('merchant_profiles').select('merchant_id, display_name, nickname, merchant_code'),
      ]);

      if (relRes.error || profileRes.error) {
        toast.error('Failed to load network merchants.');
        return;
      }

      const networkMerchants = buildNetworkMerchants(myMerchantId, relRes.data || [], profileRes.data || []);
      setMerchants(networkMerchants);

      if (networkMerchants.length === 1) {
        setSelectedRelationshipId(networkMerchants[0].relationshipId);
      }
    };

    loadNetworkMerchants();
  }, [merchantProfile?.merchant_id]);

  useEffect(() => {
    if (!selectedMerchant) {
      setRows([]);
      return;
    }
    setRows((prev) => prev.map((row) => ({
      ...row,
      selectedMerchantId: selectedMerchant.merchantId,
      selectedMerchantName: selectedMerchant.merchantName,
      saveEnabled: row.status === 'parsed' && row.parsedType === 'merchant_deal',
    })));
  }, [selectedMerchant]);

  useEffect(() => {
    if (sourceType !== 'image') {
      setImagePreviewUrl('');
      setExtractedImageText('');
      setOcrWarning(null);
      setOcrMetadata(null);
      setOcrStatus('Idle');
    }
  }, [sourceType]);

  const saveableRows = useMemo(
    () => rows.filter((row) => row.status === 'parsed' && row.parsedType === 'merchant_deal' && row.saveEnabled),
    [rows],
  );
  const saveAllowed = canSaveImportedRows(userId, selectedRelationshipId, rows) && !(sourceType === 'image' && !!ocrWarning);

  const validateFile = (nextFile: File): string | null => {
    if (sourceType === 'text_file') return validateTextFile(nextFile);
    if (sourceType === 'spreadsheet') return validateSpreadsheetFile(nextFile);
    if (sourceType === 'image') return validateImageFile(nextFile);
    return null;
  };

  const parseLines = (text: string, type: LedgerSourceType, sourceFileName?: string | null, confidencePenalty = 0) => {
    if (!userId || !selectedMerchant) {
      toast.error('Select a network merchant before parsing.');
      return;
    }

    console.debug('[ledger-import:parse] source', type);
    console.debug('[ledger-import:parse] input-length', text.length);
    console.debug('[ledger-import:parse] preview', text.slice(0, 220));

    const parsed = parseLedgerText(text, {
      uploaderUserId: userId,
      selectedMerchantId: selectedMerchant.merchantId,
      selectedMerchantName: selectedMerchant.merchantName,
      sourceType: type,
      sourceFileName,
      confidencePenalty,
    });

    setBatchId(parsed.batchId);
    setRows(parsed.rows);
    toast.success(`Parsed ${parsed.totals.parsed} supported rows. ${parsed.totals.skipped} skipped.`);
  };

  const runImageOcr = async () => {
    if (!file) {
      toast.error('Please select a photo first.');
      return;
    }

    setOcrStatus('Running OCR...');
    setOcrWarning(null);

    try {
      const ocr: OcrExtractionResult = await extractTextFromImage(file);
      setOcrStatus(ocr.ranOcr ? `OCR complete (${ocr.engine})` : 'OCR unavailable');
      setExtractedImageText(ocr.text);
      if (ocr.warning) setOcrWarning(ocr.warning);
      setOcrMetadata(ocr.metadata || null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'OCR failed.';
      setOcrWarning(message);
      setOcrStatus('OCR failed');
      toast.error(message);
    }
  };

  const handleParse = async () => {
    if (!selectedMerchant) {
      toast.error('Counterparty merchant must be selected from your network.');
      return;
    }

    setIsParsing(true);
    try {
      if (sourceType === 'pasted_text') {
        parseLines(rawText, 'pasted_text');
        return;
      }

      if (!file) {
        toast.error('Please select a file first.');
        return;
      }

      const fileValidation = validateFile(file);
      if (fileValidation) {
        toast.error(fileValidation);
        return;
      }

      if (sourceType === 'text_file') {
        const text = await readTextFile(file);
        parseLines(text, 'text_file', file.name);
        return;
      }

      if (sourceType === 'spreadsheet') {
        const workbook = await readSpreadsheet(file);
        setSheetNames(workbook.sheets);
        if (!sheetName && workbook.sheets.length > 1) setSheetName(workbook.selectedSheet);
        parseLines(workbook.lines.join('\n'), 'spreadsheet', file.name);
        return;
      }

      if (sourceType === 'image') {
        const quality = assessOcrTextQuality(extractedImageText);
        if (!extractedImageText.trim()) {
          toast.error('No OCR text found. Run OCR first or enter text manually.');
          return;
        }
        if (!quality.isValid) {
          setOcrWarning(quality.reason || 'Low quality OCR output');
          toast.error('OCR output quality is low. Please correct extracted text before parsing.');
          return;
        }
        parseLines(extractedImageText, 'image', file.name, 0.15);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to parse import source.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSave = async () => {
    if (!userId || !selectedMerchant) {
      toast.error('User and merchant context are required before saving.');
      return;
    }
    if (saveableRows.length === 0) {
      toast.error('No supported merchant_deal rows to save.');
      return;
    }

    setIsSaving(true);
    try {
      const { data: existingImports } = await supabase
        .from('merchant_deals')
        .select('metadata')
        .eq('relationship_id', selectedMerchant.relationshipId)
        .eq('created_by', userId)
        .eq('metadata->>import_source', 'manual_ledger_import')
        .limit(1000);

      const existingHashes = new Set(
        (existingImports || [])
          .map((deal: { metadata: { normalized_hash?: string } | null }) => deal.metadata?.normalized_hash)
          .filter(Boolean),
      );

      const payload = saveableRows
        .filter((row) => !existingHashes.has(row.normalizedHash))
        .map((row) => ({
          relationship_id: selectedMerchant.relationshipId,
          deal_type: 'arbitrage',
          title: `Ledger Import · USDT ${row.usdtAmount} @ ${row.rate}`,
          amount: row.computedQarAmount || 0,
          currency: 'USDT',
          status: 'pending',
          created_by: userId,
          notes: [
            'template: ledger_import_phase_1',
            `quantity: ${row.usdtAmount}`,
            `sell_price: ${row.rate}`,
            `direction: ${row.direction}`,
            `import_source: manual_ledger_import`,
            `source_file_name: ${row.sourceFileName || ''}`,
            `import_batch_id: ${batchId}`,
            `raw_line: ${row.rawLine}`,
            `intermediary: ${row.intermediary || ''}`,
            `parse_confidence: ${row.confidence}`,
          ].join(' | '),
          metadata: {
            import_source: 'manual_ledger_import',
            source_file_name: row.sourceFileName,
            import_batch_id: batchId,
            normalized_hash: row.normalizedHash,
            raw_line: row.rawLine,
            intermediary: row.intermediary,
            parse_confidence: row.confidence,
            direction: row.direction,
            uploader_user_id: row.uploaderUserId,
            counterparty_merchant_id: row.selectedMerchantId,
            counterparty_merchant_name: row.selectedMerchantName,
            source_type: row.sourceType,
          },
        }));

      if (payload.length === 0) {
        toast.error('All supported rows appear to be duplicates.');
        return;
      }

      const { error } = await supabase.from('merchant_deals').insert(payload);
      if (error) throw error;
      toast.success(`Saved ${payload.length} row(s).`);
      navigate('/trading/orders');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="tracker-root" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>Import Merchant Ledger</div>
        <button className="btn secondary" onClick={() => navigate('/trading/orders')}>Back to Orders</button>
      </div>

      <ImportSourceTabs value={sourceType} onChange={setSourceType} />

      <div className="card" style={{ padding: 10, display: 'grid', gap: 8 }}>
        <MerchantNetworkSelector
          merchants={merchants}
          selectedRelationshipId={selectedRelationshipId}
          onSelect={setSelectedRelationshipId}
        />

        {sourceType === 'pasted_text' && (
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={8} className="inp" placeholder="الصق النص هنا" />
        )}

        {sourceType !== 'pasted_text' && (
          <input
            className="inp"
            type="file"
            accept={sourceType === 'image' ? '.png,.jpg,.jpeg,.webp' : sourceType === 'spreadsheet' ? '.xlsx,.xls,.csv' : '.txt,.md,.csv'}
            onChange={(e) => {
              const nextFile = e.target.files?.[0] || null;
              if (!nextFile) return;
              const validation = validateFile(nextFile);
              if (validation) {
                toast.error(validation);
                return;
              }
              setFile(nextFile);
              setRows([]);
              if (sourceType === 'image') {
                setImagePreviewUrl(URL.createObjectURL(nextFile));
                setExtractedImageText('');
                setOcrWarning(null);
                setOcrStatus('Image selected');
                setOcrMetadata(null);
              }
            }}
          />
        )}

        {sourceType === 'spreadsheet' && sheetNames.length > 1 && (
          <select className="inp" value={sheetName} onChange={(e) => setSheetName(e.target.value)}>
            {sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}

        {sourceType === 'image' && (
          <div style={{ display: 'grid', gap: 8 }}>
            {imagePreviewUrl && <img src={imagePreviewUrl} alt="Selected upload" style={{ maxWidth: 220, borderRadius: 8, border: '1px solid var(--line)' }} />}
            <div className="pill">OCR status: {ocrStatus}</div>
            {ocrWarning && <div className="pill bad">{ocrWarning}</div>}
            {ocrMetadata && <div className="pill">OCR meta: {JSON.stringify(ocrMetadata)}</div>}
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Extracted text from image</label>
            <textarea
              className="inp"
              rows={6}
              value={extractedImageText}
              onChange={(e) => setExtractedImageText(e.target.value)}
              placeholder="OCR output appears here. You can edit before parse."
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn secondary" onClick={runImageOcr} disabled={!file}>Run OCR</button>
              <button className="btn" onClick={handleParse} disabled={isParsing || !extractedImageText.trim()}>Parse extracted text</button>
            </div>
          </div>
        )}

        {sourceType !== 'image' && (
          <button className="btn" onClick={handleParse} disabled={isParsing || merchants.length === 0}>{isParsing ? 'Parsing...' : 'Parse'}</button>
        )}

        <button className="btn" onClick={handleSave} disabled={isSaving || !saveAllowed || !selectedMerchant}>{isSaving ? 'Saving...' : `Confirm & Save (${saveableRows.length})`}</button>
      </div>

      <ImportPreviewTable rows={rows} />
    </div>
  );
}
