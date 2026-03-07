"""Shared Gemini API service for the application."""

import os
import logging
from typing import Optional
from google import genai

class GeminiService:
    """Centralized service for interacting with the Google Gemini API."""

    _instance = None

    def __new__(cls):
        """Singleton pattern to ensure only one client is instantiated."""
        if cls._instance is None:
            cls._instance = super(GeminiService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        """Initialize the Gemini client if not already initialized."""
        if self._initialized:
            return

        self.client: Optional[genai.Client] = None
        
        try:
            api_key = os.environ.get("GEMINI_API_KEY")
            
            if not api_key:
                logging.warning("[GeminiService] GEMINI_API_KEY not found in environment variables.")
            else:
                self.client = genai.Client(api_key=api_key)
                logging.info("[GeminiService] Gemini client initialized successfully.")
                
        except Exception as e:
            logging.error(f"[GeminiService] Error initializing client: {e}")
            
        self._initialized = True

    @property
    def is_available(self) -> bool:
        """Check if the Gemini client is properly initialized and available."""
        return self.client is not None

    def get_client(self) -> genai.Client:
        """
        Get the initialized Gemini client.
        
        Returns:
            genai.Client: The Gemini client.
            
        Raises:
            RuntimeError: If the client is not initialized (e.g., missing API key).
        """
        if not self.is_available:
            raise RuntimeError("Gemini client is not initialized. Please check your GEMINI_API_KEY.")
        return self.client
