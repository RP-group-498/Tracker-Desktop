"""Configuration and prompt templates for the task prioritization component."""

import os

# Gemini API configuration
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# Priority DB — auto-saved on every PDF analysis, never updates
# Separate from adaptive_time_estimation which requires user action
PRIORITY_MONGODB_URI = os.getenv("PRIORITY_MONGODB_URI", "")
PRIORITY_MONGODB_DATABASE = os.getenv("PRIORITY_MONGODB_DATABASE", "research_task_db")
PRIORITY_MONGODB_COLLECTION = os.getenv("PRIORITY_COLLECTION_TASKS", "tasks")

# MCDM weights
URGENCY_WEIGHT = 0.50
IMPACT_WEIGHT = 0.30
DIFFICULTY_WEIGHT = 0.20


def get_extraction_prompt(deadline_input: str, user_days_left: int, user_credits: int, user_weight: int, today_date_str: str) -> str:
    """
    Generate the extraction prompt for Gemini API to extract task information from PDF.

    Args:
        deadline_input: Deadline date string (YYYY-MM-DD)
        user_days_left: Days remaining until deadline
        user_credits: Module credits (1-4)
        user_weight: Assignment weight percentage
        today_date_str: Today's date string (YYYY-MM-DD)

    Returns:
        Formatted prompt string for Gemini API
    """
    return f"""
    You are an intelligent PDF task extraction and analysis system. Read this assignment/task PDF carefully and extract the following information:

    **Your Goal:**
    1. Extract the main task/assignment name or title.
    2. Extract the task description as a SIMPLE ONE-LINE QUESTION.
    3. Extract all subtasks or requirements.
    4. Extract any additional context or notes.
    5. Analyze the PDF content to predict the task's difficulty.
    6. Estimate the time required to complete the task.
    7. Estimate the time required for EACH subtask individually.

    **Instructions:**
    - Extract the EXACT text from the PDF wherever possible.
    - For `task_name`: Use the main assignment title.
    - For `task_description`: Write a clear, simple ONE-LINE QUESTION that summarizes what needs to be done (e.g., "How to implement a sorting algorithm?").
    - For `sub_tasks`: List ALL subtasks, requirements, or deliverables as objects with their name and estimated time in minutes.
    - For `context`: Include any important notes, constraints, or additional information.
    - For `ai_suggested_difficulty`: Predict the difficulty from a university student perspective on a scale of 1, 3, or 5 (Easy = 1, Medium = 3, Hard = 5).
    - For `ai_suggested_time`: Estimate the total time in hours needed for a university student to complete the task as an integer.
    - For each subtask's `estimated_minutes`: Estimate the time in minutes needed for that specific subtask as an integer (e.g., 30 for 30 minutes, 90 for 1.5 hours, 120 for 2 hours).

    **Output Format (Strict JSON):**
    {{
      "task_name": "The main assignment title or question from the PDF",
      "task_description": "A simple one-line question that describes what needs to be done (e.g., 'What is the implementation of Binary Search Tree?')",
      "sub_tasks": [
        {{
          "name": "First subtask or requirement",
          "estimated_minutes": 90
        }},
        {{
          "name": "Second subtask or requirement",
          "estimated_minutes": 45
        }},
        {{
          "name": "Third subtask or requirement",
          "estimated_minutes": 120
        }}
      ],
      "context": "Any additional notes, constraints, or important information from the PDF",
      "ai_suggested_difficulty": 3,
      "ai_suggested_time": 10
    }}

    **Important:**
    - Return ONLY valid JSON (no markdown, no code blocks, no extra text).
    - Ensure all strings are properly escaped.
    - If a field is not found, use an empty string "", empty array [], or 0 for numeric fields.

    Return ONLY the raw JSON.
    """
