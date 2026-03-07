"""
Gemini-based fallback classification.

Provides a final attempt to classify an activity using the Gemini API
when the zero-shot model returns low confidence.
"""

import json
import logging
from typing import Dict, Optional
from google.genai.errors import APIError

from app.services.gemini_service import GeminiService


class GeminiClassifier:
    """
    Fallback classifier using Google Gemini API.
    
    Prompts the Gemini model to categorize the user's current activity based on URL,
    domain, and window title into one of the four predetermined categories.
    """

    def __init__(self, config: Dict):
        """
        Initialize Gemini classifier via shared service.
        
        Args:
            config: Configuration dictionary with keys:
                - model_name: Gemini model to use
        """
        self.model_name = config.get("model_name", "gemini-2.5-flash")
        
        self.service = GeminiService()
        self._initialized = False

    def initialize(self) -> None:
        """Verify the service has a loaded client."""
        if self._initialized:
            return
            
        if self.service.is_available:
            self._initialized = True
            logging.info(f"[GeminiClassifier] Initialized with model: {self.model_name}")
        else:
            logging.error("[GeminiClassifier] GeminiService is not available.")
            raise RuntimeError("GeminiService unavailable. Ensure GEMINI_API_KEY is configured.")

    def classify(self, url: str, title: str, domain: str = "") -> Optional[Dict]:
        """
        Classify URL + title using Gemini API.

        Args:
            url: Full URL of the webpage
            title: Page title or window title
            domain: Domain name (optional)

        Returns:
            Dict with classification result:
                {
                    "category": str,  # academic/productivity/neutral/non_academic
                    "confidence": float,  # 0.0-1.0
                    "source": "model",
                    "explanation": str,  # Human-readable explanation
                    "model_name": str,  # Model used
                }
            Returns None on failure.
        """
        if not self._initialized:
            logging.warning("[GeminiClassifier] Not initialized")
            return None

        # Build prompt
        prompt = self._build_prompt(url, title, domain)
        
        try:
            client = self.service.get_client()
            response = client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                }
            )
            
            result_text = response.text
            if not result_text:
                logging.warning("[GeminiClassifier] Empty response from Gemini")
                return None
                
            # Parse the JSON response
            parsed_result = json.loads(result_text)
            
            category = parsed_result.get("category", "neutral").lower()
            confidence = float(parsed_result.get("confidence", 0.5))
            explanation = parsed_result.get("explanation", "No reasoning provided.")
            
            # Validate category
            valid_categories = {"academic", "productivity", "neutral", "non_academic"}
            if category not in valid_categories:
                logging.warning(f"[GeminiClassifier] Invalid category returned: {category}, defaulting to neutral")
                category = "neutral"
                confidence = 0.5

            output = {
                "category": category,
                "confidence": confidence,
                "source": "model",
                "explanation": f"Gemini Fallback: {explanation}",
                "model_name": self.model_name,
            }
            
            logging.debug(f"[GeminiClassifier] {domain} -> {category} (conf: {confidence})")
            return output

        except json.JSONDecodeError as e:
            logging.error(f"[GeminiClassifier] Failed to parse JSON response: {e}")
            return None
        except APIError as e:
            logging.error(f"[GeminiClassifier] Gemini API Error: {e}")
            return None
        except Exception as e:
            logging.error(f"[GeminiClassifier] Unexpected error during classification: {e}")
            return None

    def _build_prompt(self, url: str, title: str, domain: str) -> str:
        """
        Build the extraction prompt for Gemini API.
        
        Args:
            url: The URL visited
            title: The page/window title
            domain: The domain visited
            
        Returns:
            A formatted prompt string expecting a JSON representation back.
        """
        return f"""
        You are an intelligent activity classifier. Classify the user's current activity based on the following context:
        
        Context:
        - Domain: {domain}
        - Title: {title}
        - URL: {url}
        
        Categories:
        - "academic": Related to studying, doing research, academic learning, university courses, scientific literature, reading research papers, writing theses.
        - "productivity": Related to software development, coding, reading documentation, using project management tools, or executing work-related tasks.
        - "neutral": General web browsing, email, communications, utility tools, searching for generic information.
        - "non_academic": Relaxation, watching entertainment/movies, gaming, casual social media, or online shopping.
        
        Task:
        Choose the most relevant category from the 4 categories described above.
        Also provide a confidence score from 0.0 to 1.0 representing your certainty, and a short 1-sentence explanation of your reasoning.
        
        Output MUST be valid JSON matching this schema:
        {{
            "category": "academic|productivity|neutral|non_academic",
            "confidence": 0.85,
            "explanation": "Short reasoning here"
        }}
        """

    def classify_batch(self, items: list[dict]) -> Optional[dict]:
        """
        Classify a batch of URLs/domains using a single Gemini API call.

        Args:
            items: List of dicts, each containing:
                   {"id": "...", "domain": "...", "title": "...", "url": "..."}

        Returns:
            Dict mapping item "id" to its classification result:
            {
                "id1": {"category": "...", "confidence": 0.9, "explanation": "...", "source": "gemini"},
                ...
            }
        """
        if not self._initialized:
            logging.warning("[GeminiClassifier] Not initialized for batch")
            return None
            
        if not items:
            return {}

        prompt = self._build_batch_prompt(items)
        
        try:
            client = self.service.get_client()
            response = client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                }
            )
            
            result_text = response.text
            if not result_text:
                logging.warning("[GeminiClassifier] Empty response from Gemini batch")
                return None
                
            parsed_result = json.loads(result_text)
            output = {}
            valid_categories = {"academic", "productivity", "neutral", "non_academic"}
            
            # Expecting a list of results from Gemini
            if isinstance(parsed_result, list):
                for item_res in parsed_result:
                    item_id = item_res.get("id")
                    if not item_id:
                        continue
                        
                    category = item_res.get("category", "neutral").lower()
                    if category not in valid_categories:
                        category = "neutral"
                        
                    output[item_id] = {
                        "category": category,
                        "confidence": float(item_res.get("confidence", 0.5)),
                        "explanation": f"Gemini Batch: {item_res.get('explanation', 'None')}",
                        "source": "gemini",
                        "model_name": self.model_name
                    }
            return output

        except json.JSONDecodeError as e:
            logging.error(f"[GeminiClassifier] Failed to parse batch JSON response: {e}\nResponse text: {result_text}")
            return None
        except Exception as e:
            logging.error(f"[GeminiClassifier] Error during batch classification: {e}")
            return None

    def _build_batch_prompt(self, items: list[dict]) -> str:
        """Build the prompt for batch classification."""
        items_json = json.dumps(items, indent=2)
        return f"""
        You are an intelligent activity classifier. Classify the following list of user activities.
        
        Categories:
        - "academic": Related to studying, doing research, academic learning, university courses, scientific literature, reading research papers, writing theses.
        - "productivity": Related to software development, coding, reading documentation, using project management tools, or executing work-related tasks.
        - "neutral": General web browsing, email, communications, utility tools, searching for generic information.
        - "non_academic": Relaxation, watching entertainment/movies, gaming, casual social media, or online shopping.
        
        Input Activities:
        {items_json}
        
        Task:
        For EACH activity in the list, choose the most relevant category.
        Provide a confidence score (0.0 to 1.0) and a short 1-sentence explanation.
        
        Output MUST be a valid JSON ARRAY of objects matching this exact schema:
        [
            {{
                "id": "<matching the input id>",
                "category": "academic|productivity|neutral|non_academic",
                "confidence": 0.85,
                "explanation": "Short reasoning here"
            }},
            ...
        ]
        Return ONLY valid JSON.
        """

    def get_stats(self) -> Dict:
        """Return classifier statistics."""
        return {
            "initialized": self._initialized,
            "model": self.model_name,
            "type": "gemini_api"
        }
