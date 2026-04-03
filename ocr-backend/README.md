# EasyOCR Backend Service

This service provides Arabic-enabled OCR for the Orders ledger image import flow.

## Endpoint

- `POST /api/ocr/extract`
- multipart form field: `image`
- response: `{ text, engine, metadata }`

## Run locally

```bash
cd ocr-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Then set frontend env:

```bash
VITE_OCR_SERVICE_URL=http://localhost:8000/api/ocr/extract
```

## Notes

- EasyOCR is backend-only (Python + PyTorch) and is intentionally not bundled in the React frontend.
- Frontend only sends image file and receives extracted text + metadata.
