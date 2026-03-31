import type { LedgerParseRow } from '@/types/ledgerImport';

interface Props {
  rows: LedgerParseRow[];
}

export function ImportPreviewTable({ rows }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="tableWrap ledgerWrap">
      <table>
        <thead>
          <tr>
            <th>Source</th><th>Raw line / extracted row</th><th>Parse result</th><th>Type</th><th>Direction</th>
            <th className="r">USDT amount</th><th className="r">Rate</th><th className="r">QAR amount</th>
            <th>Uploader</th><th>Counterparty merchant</th><th>Intermediary</th><th className="r">Confidence</th>
            <th>Status</th><th>Skip reason</th><th>Save enabled?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.id}-${row.lineIndex}`}>
              <td>{row.sourceType}</td>
              <td style={{ maxWidth: 240 }}>{row.rawLine}</td>
              <td>{row.parseResult}</td>
              <td>{row.parsedType}</td>
              <td>{row.direction ?? '—'}</td>
              <td className="r">{row.usdtAmount ?? '—'}</td>
              <td className="r">{row.rate ?? '—'}</td>
              <td className="r">{row.computedQarAmount ?? '—'}</td>
              <td>{row.uploaderUserId.slice(0, 8)}</td>
              <td>{row.selectedMerchantName ?? '—'}</td>
              <td>{row.intermediary ?? '—'}</td>
              <td className="r">{row.confidence.toFixed(2)}</td>
              <td>{row.status}</td>
              <td>{row.skipReason ?? '—'}</td>
              <td>{row.saveEnabled ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
