import fitz  # PyMuPDF
import re
from typing import List, Dict

class PDFService:
    @staticmethod
    def extract_text(file_path: str) -> str:
        """
        Extracts all selectable text from a PDF file.
        """
        doc = fitz.open(file_path)
        full_text = []
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            page_text = page.get_text("text")
            
            # Simple clean up of page text
            if page_text.strip():
                full_text.append(page_text)
                
        doc.close()
        return "\n\n--- PAGE BREAK ---\n\n".join(full_text)

    @staticmethod
    def clean_text(text: str) -> str:
        """
        Cleans extracted text by normalizing spaces, removing page numbers/headers,
        and cleaning up line breaks within paragraphs.
        """
        # Remove page break markers
        text = text.replace("\n\n--- PAGE BREAK ---\n\n", " ")
        
        # Replace multiple newlines or tabs with a single spaces within paragraphs
        # but try to preserve double newlines as paragraph boundaries
        paragraphs = text.split("\n\n")
        cleaned_paragraphs = []
        
        for para in paragraphs:
            # Clean up spacing and carriage returns
            para_clean = re.sub(r'\s+', ' ', para).strip()
            
            # Filter out lines that look like page numbers (e.g. "Page 1 of 12" or "12")
            if re.match(r'^\d+$', para_clean) or re.match(r'^page\s+\d+(\s+of\s+\d+)?$', para_clean, re.IGNORECASE):
                continue
                
            if para_clean:
                cleaned_paragraphs.append(para_clean)
                
        return "\n\n".join(cleaned_paragraphs)

    @staticmethod
    def chunk_text(text: str, max_chars: int = 4000) -> List[str]:
        """
        Splits text into chunks of at most max_chars, trying to split at paragraph
        boundaries first, and sentence boundaries (periods/question marks/exclamations) second.
        """
        if len(text) <= max_chars:
            return [text] if text else []
            
        paragraphs = text.split("\n\n")
        chunks = []
        current_chunk = ""
        
        for para in paragraphs:
            # If a single paragraph is larger than max_chars, split by sentence
            if len(para) > max_chars:
                # First append current chunk if any
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = ""
                    
                # Split paragraph by sentences
                # Using standard regex to split by punctuation followed by space
                sentences = re.split(r'(?<=[.!?])\s+', para)
                for sentence in sentences:
                    if len(current_chunk) + len(sentence) + 1 <= max_chars:
                        current_chunk += " " + sentence
                    else:
                        if current_chunk:
                            chunks.append(current_chunk.strip())
                        # If a single sentence is longer than max_chars, split it by characters
                        if len(sentence) > max_chars:
                            sub_sentences = [sentence[i:i+max_chars] for i in range(0, len(sentence), max_chars)]
                            chunks.extend(sub_sentences[:-1])
                            current_chunk = sub_sentences[-1]
                        else:
                            current_chunk = sentence
            else:
                # If paragraph fits in current chunk
                if len(current_chunk) + len(para) + 2 <= max_chars:
                    if current_chunk:
                        current_chunk += "\n\n" + para
                    else:
                        current_chunk = para
                else:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    current_chunk = para
                    
        if current_chunk:
            chunks.append(current_chunk.strip())
            
        return chunks
