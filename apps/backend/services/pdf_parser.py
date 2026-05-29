from pathlib import Path
import fitz  # pymupdf


def extract_text_from_pdf(filepath: str | Path) -> str:
    """Extract all text from a PDF file. Raises ValueError if no text found (image-only PDF)."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Resume file not found: {filepath}")

    doc = fitz.open(str(path))
    text_parts = []
    for page in doc:
        text_parts.append(page.get_text())
    doc.close()

    full_text = "\n".join(text_parts).strip()
    if not full_text:
        raise ValueError("Resume appears to be image-only or contains no extractable text")

    return full_text
