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

interface ParseInput {
  text: string;
  sourceType: LedgerSourceType;
  sourceFileName?: string | null;
  confidencePenalty?: number;
}

export default function OrdersImportLedgerPage() {
  const navigate = useNavigate();
  const { userId, merchantProfile } = useAuth();

  const [sourceType, setSourceType] = useState<LedgerSourceType>('pasted_text');
  const [rawText, setRawText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [ocrStatus, setOcrStatus] = useState('Idle');
  const [ocrWarning, setOcrWarning] = useState<string | null>(null);
  const [ocrMetadata, setOcrMetadata] = useState<Record<string, unknown>[]>([]);
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
      if (networkMerchants.length === 1) setSelectedRelationshipId(networkMerchants[0].relationshipId);
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
      setImagePreviewUrls([]);
      setExtractedImageText('');
      setOcrWarning(null);
      setOcrMetadata([]);
      setOcrStatus('Idle');
    }
  }, [sourceType]);

  const saveableRows = useMemo(() => rows.filter((row) => row.status === 'parsed' && row.parsedType === 'merchant_deal' && row.saveEnabled), [rows]);
  const saveAllowed = canSaveImportedRows(userId, selectedRelationshipId, rows) && !(sourceType === 'image' && !!ocrWarning);

  const validateFile = (nextFile: File): string | null => {
    if (sourceType === 'text_file') return validateTextFile(nextFile);
    if (sourceType === 'spreadsheet') return validateSpreadsheetFile(nextFile);
    if (sourceType === 'image') return validateImageFile(nextFile);
    return null;
  };

  const parseInputs = (inputs: ParseInput[]) => {
    if (!userId || !selectedMerchant) {
      toast.error('Select a network merchant before parsing.');
      return;
    }

    const seen = new Set<string>();
    const merged: LedgerParseRow[] = [];

    inputs.forEach((input, idx) => {
      console.debug('[ledger-import:parse] source', input.sourceType, input.sourceFileName || 'manual');
      const parsed = parseLedgerText(input.text, {
        uploaderUserId: userId,
        selectedMerchantId: selectedMerchant.merchantId,
        selectedMerchantName: selectedMerchant.merchantName,
        sourceType: input.sourceType,
        sourceFileName: input.sourceFileName,
        lineOffset: idx * 100000,
        confidencePenalty: input.confidencePenalty ?? 0,
      });

      parsed.rows.forEach((row) => {
        if (seen.has(row.normalizedHash)) {
          merged.push({ ...row, status: 'skipped', parseResult: 'Skipped', skipReason: 'Duplicate line in batch', saveEnabled: false });
          return;
        }
        seen.add(row.normalizedHash);
        merged.push(row);
      });
    });

    setBatchId(crypto.randomUUID());
    setRows(merged);
    toast.success(`Parsed ${merged.filter((r) => r.status === 'parsed').length} supported rows. ${merged.filter((r) => r.status === 'skipped').length} skipped.`);
  };

  const runImageOcr = async () => {
    if (files.length === 0) {
      toast.error('Please select photos first.');
      return;
    }

    setOcrStatus('Running OCR...');
    setOcrWarning(null);
    const ocrLines: string[] = [];
    const meta: Record<string, unknown>[] = [];

    try {
      for (const file of files) {
        const ocr: OcrExtractionResult = await extractTextFromImage(file);
        if (ocr.text.trim()) ocrLines.push(ocr.text.trim());
        if (ocr.warning) setOcrWarning(ocr.warning);
        meta.push({ file: file.name, ...(ocr.metadata || {}), engine: ocr.engine });
      }
      setExtractedImageText(ocrLines.join('\n'));
      setOcrMetadata(meta);
      setOcrStatus(`OCR complete for ${files.length} image(s)`);
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
        parseInputs([{ text: rawText, sourceType: 'pasted_text' }]);
        return;
      }

      if (files.length === 0) {
        toast.error('Please select file(s) first.');
        return;
      }

      for (const file of files) {
        const fileValidation = validateFile(file);
        if (fileValidation) {
          toast.error(`${file.name}: ${fileValidation}`);
          return;
        }
      }

      if (sourceType === 'text_file') {
        const inputs: ParseInput[] = [];
        for (const file of files) {
          const text = await readTextFile(file);
          inputs.push({ text, sourceType: 'text_file', sourceFileName: file.name });
        }
        parseInputs(inputs);
        return;
      }

      if (sourceType === 'spreadsheet') {
        const inputs: ParseInput[] = [];
        const sheetSet = new Set<string>();
        for (const file of files) {
          const workbook = await readSpreadsheet(file);
          workbook.sheets.forEach((s) => sheetSet.add(s));
          inputs.push({ text: workbook.lines.join('\n'), sourceType: 'spreadsheet', sourceFileName: file.name });
        }
        setSheetNames(Array.from(sheetSet));
        if (!sheetName && sheetSet.size > 0) setSheetName(Array.from(sheetSet)[0]);
        parseInputs(inputs);
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
        parseInputs([{ text: extractedImageText, sourceType: 'image', sourceFileName: files.map((f) => f.name).join(','), confidencePenalty: 0.15 }]);
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

      const existingHashes = new Set((existingImports || []).map((deal: any) => deal.metadata?.normalized_hash).filter(Boolean));

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
        <MerchantNetworkSelector merchants={merchants} selectedRelationshipId={selectedRelationshipId} onSelect={setSelectedRelationshipId} />

        {sourceType === 'pasted_text' && (
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={8} className="inp" placeholder="الصق النص هنا" />
        )}

        {sourceType !== 'pasted_text' && (
          <>
            <input
              className="inp"
              type="file"
              multiple
              accept={sourceType === 'image' ? '.png,.jpg,.jpeg,.webp' : sourceType === 'spreadsheet' ? '.xlsx,.xls,.csv' : '.txt,.md,.csv'}
              onChange={(e) => {
                const selected = Array.from(e.target.files || []);
                if (selected.length === 0) return;
                for (const file of selected) {
                  const validation = validateFile(file);
                  if (validation) {
                    toast.error(`${file.name}: ${validation}`);
                    return;
                  }
                }
                setFiles(selected);
                setRows([]);
                if (sourceType === 'image') {
                  setImagePreviewUrls(selected.map((file) => URL.createObjectURL(file)));
                  setExtractedImageText('');
                  setOcrWarning(null);
                  setOcrMetadata([]);
                  setOcrStatus(`${selected.length} image(s) selected`);
                }
              }}
            />
            {files.length > 0 && <div className="pill">Selected: {files.length} file(s)</div>}
          </>
        )}

        {sourceType === 'spreadsheet' && sheetNames.length > 1 && (
          <select className="inp" value={sheetName} onChange={(e) => setSheetName(e.target.value)}>
            {sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}

        {sourceType === 'image' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {imagePreviewUrls.map((url) => <img key={url} src={url} alt="Selected upload" style={{ maxWidth: 140, borderRadius: 8, border: '1px solid var(--line)' }} />)}
            </div>
            <div className="pill">OCR status: {ocrStatus}</div>
            {ocrWarning && <div className="pill bad">{ocrWarning}</div>}
            {ocrMetadata.length > 0 && <div className="pill">OCR meta: {JSON.stringify(ocrMetadata)}</div>}
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Extracted text from image(s)</label>
            <textarea className="inp" rows={8} value={extractedImageText} onChange={(e) => setExtractedImageText(e.target.value)} placeholder="OCR output appears here. You can edit before parse." />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn secondary" onClick={runImageOcr} disabled={files.length === 0}>Run OCR</button>
              <button className="btn" onClick={handleParse} disabled={isParsing || !extractedImageText.trim()}>Parse extracted text</button>
            </div>
          </div>
        )}

        {sourceType !== 'image' && <button className="btn" onClick={handleParse} disabled={isParsing || merchants.length === 0}>{isParsing ? 'Parsing...' : 'Parse'}</button>}

        <button className="btn" onClick={handleSave} disabled={isSaving || !saveAllowed || !selectedMerchant}>{isSaving ? 'Saving...' : `Confirm & Save (${saveableRows.length})`}</button>
      </div>

      <ImportPreviewTable rows={rows} />
    </div>
  );
}
