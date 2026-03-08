import os
import sys
import logging
from pprint import pprint

# Configure logging to see the inner workings
logging.basicConfig(level=logging.DEBUG, format='%(levelname)s - %(message)s')

# Adjust the path so we can import app modules directly
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

from app.components.classification.component import ClassificationComponent

def main():
    print("=== Testing Enhanced Classification Component with Gemini Fallback ===\n")

    # 1. Initialize the component with ML and Gemini enabled
    config = {
        "ml": {
            "enabled": True,
            "lazy_loading": False,  # Eager load for testing to see initialization logs
            "model_type": "zero_shot",
            "zero_shot": {
                "model_name": "facebook/bart-large-mnli",
                "device": "cpu",
                "confidence_threshold": 0.80,  # Setting artificially high to FORCE fallback to Gemini
            },
            "gemini": {
                "model_name": "gemini-2.5-flash"
            }
        }
    }

    print("Initializing component...")
    classifier = ClassificationComponent()
    classifier.initialize(config)
    print("\nInitialization Complete.\n")

    # 2. Test Cases
    test_cases = [
        # Case 1: Should be caught by RULES easily
        {
            "name": "Clear Academic Rule",
            "data": {
                "source": "browser",
                "url": "https://scholar.google.com/scholar?q=machine+learning",
                "title": "machine learning - Google Scholar",
                "domain": "scholar.google.com",
            }
        },
        # Case 2: Ambiguous but zero-shot might get it or it might fall back
        {
            "name": "Ambiguous/Niche Website",
            "data": {
                "source": "browser",
                "url": "https://example-niche-blog.dev/post/understanding-latency",
                "title": "Deep Dive into Latency and Throughput",
                "domain": "example-niche-blog.dev",
            }
        },
        # Case 3: Deliberately confusing title and domain to force Gemini to decide
        {
            "name": "Highly Ambiguous (Forces Gemini Fallback)",
            "data": {
                "source": "browser",
                "url": "https://random-forum-site.com/thread/12345",
                "title": "Is the new 10x developer framework actually useful?",
                "domain": "random-forum-site.com",
            }
        }
    ]

    # 3. Process test cases
    for case in test_cases:
        print(f"\n--- Running Test Case: {case['name']} ---")
        try:
            result = classifier.process(case["data"])
            print("Result:")
            pprint(result)
        except Exception as e:
            print(f"Error classifying: {e}")

    # 4. Display Final Status
    print("\n=== Final Component Status ===")
    status = classifier.get_status()
    pprint(status['stats'])
    if 'gemini_status' in status:
        print("\nGemini Service Status:")
        pprint(status['gemini_status'])

if __name__ == "__main__":
    main()
