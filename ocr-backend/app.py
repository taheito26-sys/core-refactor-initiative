"""EasyOCR backend service for ledger image extraction.

Run:
  pip install -r requirements.txt
  uvicorn app:app --host 0.0.0.0 --port 8000
"""

from io import BytesIO
from typing import Any, Dict

import easyocr
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image

app = FastAPI(title="Ledger OCR Service")
reader = easyocr.Reader(['ar', 'en'], gpu=False)


@app.post('/api/ocr/extract')
async def extract_ocr(image: UploadFile = File(...)) -> Dict[str, Any]:
    if not image.content_type or not image.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail='Invalid image file')

    data = await image.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail='Image exceeds 10MB limit')

    try:
        pil_image = Image.open(BytesIO(data)).convert('RGB')
    except Exception as exc:
        raise HTTPException(status_code=400, detail='Failed to decode image') from exc

    results = reader.readtext(pil_image)
    text_parts = [entry[1].strip() for entry in results if len(entry) > 1 and entry[1].strip()]
    mean_conf = 0.0
    if results:
      mean_conf = sum(float(entry[2]) for entry in results if len(entry) > 2) / len(results)

    return {
        'text': '\n'.join(text_parts),
        'engine': 'easyocr',
        'metadata': {
            'language': ['ar', 'en'],
            'lines': len(text_parts),
            'mean_confidence': mean_conf,
        },
    }
