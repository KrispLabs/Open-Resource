from pathlib import Path
import fitz  # pymupdf

_UNREADABLE_FALLBACK = (
    "[Resume could not be parsed: the uploaded file is empty, corrupted, or image-only "
    "with no selectable text. Score this candidate conservatively — award minimal points "
    "across all categories and note in the feedback that the resume was unreadable.]"
)


def extract_text_from_pdf(filepath: str | Path) -> str:
    """
    Extract text from a PDF file.

    If the PDF is empty, corrupted, or image-only (no selectable text), returns a
    fallback string instead of raising so the AI scorer can still produce output
    (with appropriately low scores) rather than failing the candidate entirely.

    Raises FileNotFoundError only if the file does not exist.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Resume file not found: {filepath}")

    try:
        doc = fitz.open(str(path))
        text_parts = [page.get_text() for page in doc]
        doc.close()
    except Exception:
        return _UNREADABLE_FALLBACK

    full_text = "\n".join(text_parts).strip()
    return full_text if full_text else _UNREADABLE_FALLBACK
