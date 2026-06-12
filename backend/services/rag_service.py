import re
from typing import List, Dict, Tuple
from collections import Counter
import math

class RAGService:
    @staticmethod
    def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        """
        Splits text into overlapping chunks of approximately chunk_size characters.
        Splits on sentence or paragraph boundaries where possible.
        """
        if not text:
            return []
            
        if len(text) <= chunk_size:
            return [text]
            
        # First split by paragraph to find natural boundaries
        paragraphs = text.split("\n\n")
        chunks = []
        current_chunk = ""
        
        for para in paragraphs:
            # If paragraph fits in current chunk
            if len(current_chunk) + len(para) + 2 <= chunk_size:
                if current_chunk:
                    current_chunk += "\n\n" + para
                else:
                    current_chunk = para
            else:
                # If paragraph itself is too large, split it by sentence
                if len(para) > chunk_size:
                    # Flush current chunk first
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                        current_chunk = ""
                        
                    sentences = re.split(r'(?<=[.!?])\s+', para)
                    for sentence in sentences:
                        if len(current_chunk) + len(sentence) + 1 <= chunk_size:
                            if current_chunk:
                                current_chunk += " " + sentence
                            else:
                                current_chunk = sentence
                        else:
                            if current_chunk:
                                chunks.append(current_chunk.strip())
                            # Handle extremely long sentences
                            if len(sentence) > chunk_size:
                                for i in range(0, len(sentence), chunk_size - overlap):
                                    chunks.append(sentence[i:i + chunk_size])
                                current_chunk = ""
                            else:
                                current_chunk = sentence
                else:
                    # Current chunk is full, save it and start a new one
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    
                    # Implement overlap by backing up a bit in the text
                    # (Simplified: start the new chunk with the last paragraph if it fits in overlap)
                    if len(para) <= overlap:
                        current_chunk = para
                    else:
                        current_chunk = para
                        
        if current_chunk:
            chunks.append(current_chunk.strip())
            
        # Ensure we don't have empty chunks and add a simple sliding window fallback if chunking failed
        chunks = [c for c in chunks if c.strip()]
        if not chunks:
            # Simple sliding window character split
            step = chunk_size - overlap
            for i in range(0, len(text), step):
                chunks.append(text[i:i + chunk_size])
                if i + chunk_size >= len(text):
                    break
                    
        return chunks

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        """
        Tokenizes text by lowercasing and extracting alphanumeric words.
        """
        return re.findall(r'\w+', text.lower())

    @classmethod
    def keyword_search(cls, chunks: List[str], query: str, top_k: int = 4) -> List[Tuple[float, str]]:
        """
        Performs a TF-IDF-like keyword search over the text chunks.
        Returns a list of tuples containing (score, chunk_text) sorted by score descending.
        """
        query_tokens = cls._tokenize(query)
        if not query_tokens or not chunks:
            return [(0.0, chunk) for chunk in chunks[:top_k]]
            
        # Filter out extremely common English stop words to improve accuracy
        stopwords = {
            'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 
            'be', 'been', 'being', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 
            'by', 'to', 'from', 'up', 'about', 'into', 'over', 'after', 'this', 
            'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 
            'what', 'which', 'who', 'whom', 'how', 'why', 'where', 'when'
        }
        filtered_query_tokens = [t for t in query_tokens if t not in stopwords]
        if not filtered_query_tokens:
            filtered_query_tokens = query_tokens # fallback if query was only stopwords
            
        query_counter = Counter(filtered_query_tokens)
        
        # Calculate doc frequency for query terms
        doc_frequency = Counter()
        for chunk in chunks:
            chunk_tokens = set(cls._tokenize(chunk))
            for token in query_counter:
                if token in chunk_tokens:
                    doc_frequency[token] += 1
                    
        scores = []
        num_docs = len(chunks)
        
        for chunk in chunks:
            chunk_tokens = cls._tokenize(chunk)
            chunk_counter = Counter(chunk_tokens)
            doc_len = len(chunk_tokens)
            
            if doc_len == 0:
                scores.append((0.0, chunk))
                continue
                
            score = 0.0
            for token, q_count in query_counter.items():
                if token in chunk_counter:
                    # Term Frequency (TF)
                    tf = chunk_counter[token] / doc_len
                    # Inverse Document Frequency (IDF)
                    df = doc_frequency[token]
                    idf = math.log((num_docs + 1) / (df + 1)) + 1
                    # TF-IDF score contribution
                    score += tf * idf * q_count
                    
            scores.append((score, chunk))
            
        # Sort by score descending
        scores.sort(key=lambda x: x[0], reverse=True)
        return scores[:top_k]

    @classmethod
    def retrieve_context(cls, text: str, query: str, top_k: int = 4) -> str:
        """
        Chunks the document text, searches for the top_k most relevant chunks,
        and combines them into a single context string.
        """
        chunks = cls.chunk_text(text)
        results = cls.keyword_search(chunks, query, top_k=top_k)
        
        # Join retrieved chunks with a visual marker
        context_parts = []
        for i, (score, chunk) in enumerate(results):
            context_parts.append(f"[Relevance Block {i+1}]:\n{chunk}")
            
        return "\n\n---\n\n".join(context_parts)
