"""PDF extraction using Google Gemini API."""

import os
from pathlib import Path
from google import genai
from google.genai.types import Part

from .config import GEMINI_MODEL

import logging
from app.services.gemini_service import GeminiService

class GeminiPDFExtractor:
    """Handle PDF extraction using Gemini API."""

    def __init__(self):
        """Initialize Gemini client via the shared service."""
        try:
            gemini_service = GeminiService()
            self.client = gemini_service.get_client()
            logging.info("GeminiPDFExtractor initialized with shared Gemini service.")
        except Exception as e:
            logging.error(f"Error initializing GeminiPDFExtractor: {e}")
            raise

    def extract_text_from_pdf(self, pdf_path: str, extraction_prompt: str) -> str:
        """
        Read a PDF file and extract text using Gemini API.

        Args:
            pdf_path: Path to the PDF file
            extraction_prompt: Prompt for text extraction

        Returns:
            Extracted text from Gemini API

        Raises:
            FileNotFoundError: If PDF file doesn't exist
        """
        pdf_file = Path(pdf_path)

        if not pdf_file.exists():
            raise FileNotFoundError(f"File not found: {pdf_path}")

        print(f"Loading PDF file: {pdf_path}")

        with open(pdf_file, "rb") as f:
            pdf_data = f.read()

        pdf_part = Part.from_bytes(
            data=pdf_data,
            mime_type='application/pdf'
        )

        contents = [pdf_part, extraction_prompt]

        print(f"Sending request to {GEMINI_MODEL}...")

        response = self.client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents
        )

        return response.text

    def analyze_text_content(self, text_content: str, extraction_prompt: str) -> str:
        """
        Analyze raw text content using Gemini API.

        Args:
            text_content: Raw text description of the task
            extraction_prompt: Prompt for analysis

        Returns:
            Analysis result from Gemini API
        """
        print(f"Sending text content to {GEMINI_MODEL}...")

        contents = [text_content, extraction_prompt]

        response = self.client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents
        )

        return response.text
